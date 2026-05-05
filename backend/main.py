from __future__ import annotations

import asyncio
import hashlib
import os
import re
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - keeps the app importable before deps are installed.
    load_dotenv = None


def _load_backend_env() -> None:
    env_path = Path(__file__).with_name(".env")
    if load_dotenv is not None:
        load_dotenv(env_path, encoding="utf-8-sig")
        return

    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


_load_backend_env()

app = FastAPI(title="ATLAS Backend", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATASETS: dict[str, dict[str, object]] = {}
ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
INTERNAL_COLUMN_PREFIX = "_atlas_"
NULL_TEXT_TOKENS = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "null",
    "none",
    "unknown",
}
GEMINI_API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_DEFAULT_MODEL = "gemini-flash-latest"
GEMINI_DEFAULT_FALLBACK_MODELS = ("gemini-2.5-flash", "gemini-2.0-flash-lite")
AI_INSIGHTS_CACHE_VERSION = "polished-v3"
GEMINI_INSIGHTS_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "key_insights": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
        },
        "trends": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
        },
        "data_quality_notes": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
        },
        "simple_recommendations": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
        },
    },
    "required": [
        "key_insights",
        "trends",
        "data_quality_notes",
        "simple_recommendations",
    ],
}


class GeminiAPIError(Exception):
    def __init__(
        self,
        detail: str,
        *,
        provider_status_code: int | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.provider_status_code = provider_status_code
        self.retryable = retryable


class DatasetUpdatePayload(BaseModel):
    columns: list[str] = Field(default_factory=list, min_length=1)
    rows: list[dict[str, object]] = Field(default_factory=list)


class DatasetRenamePayload(BaseModel):
    filename: str = Field(min_length=1, max_length=180)


class VisualizationOverridePayload(BaseModel):
    chart_type: str | None = None
    x_axis: str | None = None
    y_axis: str | None = None
    aggregation: str = "count"


class VisualizationFilterPayload(BaseModel):
    column: str
    type: str | None = None
    values: list[object] = Field(default_factory=list)
    start: object | None = None
    end: object | None = None
    min: object | None = None
    max: object | None = None


class VisualizationChartOverridePayload(VisualizationOverridePayload):
    id: str
    source: str | None = None


class VisualizationDatasetPayload(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, object]] = Field(default_factory=list)
    override: VisualizationOverridePayload | None = None
    filters: list[VisualizationFilterPayload] = Field(default_factory=list)
    chart_overrides: list[VisualizationChartOverridePayload] = Field(default_factory=list)


class CleaningConfigPayload(BaseModel):
    normalize_placeholder_nulls: bool | None = None
    standardize_text: bool | None = None
    convert_datetime_columns: bool | None = None
    convert_numeric_columns: bool | None = None
    validate_emails: bool | None = None
    validate_numeric_ranges: bool | None = None
    validate_future_dates: bool | None = None
    drop_all_null_rows: bool | None = None
    remove_duplicates: bool | None = None
    flag_duplicate_keys: bool | None = None
    flag_required_missing: bool | None = None
    drop_critical_missing: bool | None = None
    fill_numeric_missing: bool | None = None
    fill_datetime_missing: bool | None = None
    fill_text_with_mode: bool | None = None
    critical_keywords: list[str] | None = None
    required_keywords: list[str] | None = None
    required_missing_drop_threshold: float | None = Field(default=None, ge=0, le=1)
    numeric_skew_threshold: float | None = Field(default=None, ge=0)


@app.get("/")
def home() -> dict[str, str]:
    return {"message": "ATLAS backend running"}


def _get_extension(filename: str) -> str:
    if "." not in filename:
        return ""
    return f".{filename.rsplit('.', 1)[-1].lower()}"


def _validate_upload_file(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file was provided")

    extension = _get_extension(file.filename)
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files (.csv, .xlsx, .xls) are allowed",
        )

    return extension


def _read_tabular_file(content: bytes, extension: str) -> pd.DataFrame:
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        if extension == ".csv":
            return _normalize_dataframe_input(pd.read_csv(BytesIO(content)))
        return _normalize_dataframe_input(pd.read_excel(BytesIO(content)))
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="Uploaded file has no data") from None
    except pd.errors.ParserError:
        raise HTTPException(status_code=400, detail="Invalid file format") from None
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Unable to decode file as text") from None
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="Excel support requires additional dependency (openpyxl/xlrd)",
        ) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse file: {exc}") from None
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process uploaded file") from None


def _normalize_nullable_value(value: object) -> object:
    if value is None:
        return None

    try:
        if pd.isna(value):  # type: ignore[arg-type]
            return None
    except TypeError:
        pass

    if isinstance(value, str):
        normalized = re.sub(r"\s+", " ", value.strip())
        if normalized.lower() in NULL_TEXT_TOKENS:
            return None
        return normalized

    return value


def _normalize_dataframe_input(df: pd.DataFrame) -> pd.DataFrame:
    normalized_df = df.copy()
    for column in normalized_df.columns:
        if pd.api.types.is_object_dtype(normalized_df[column]) or pd.api.types.is_string_dtype(normalized_df[column]):
            normalized_df[column] = normalized_df[column].map(_normalize_nullable_value)
    return normalized_df


def _is_numeric_input_column(column_name: str, previous_series: pd.Series | None = None) -> bool:
    if previous_series is not None and pd.api.types.is_numeric_dtype(previous_series):
        return True
    normalized = _normalize_column_name(column_name)
    return normalized in {"age"}


def _json_safe(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}

    if isinstance(value, list):
        return [_json_safe(item) for item in value]

    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]

    if value is None:
        return None

    if isinstance(value, (pd.Timestamp, pd.Timedelta)):
        return str(value)

    if isinstance(value, np.integer):
        return int(value)

    if isinstance(value, np.floating):
        return None if pd.isna(value) else float(value)

    if isinstance(value, np.bool_):
        return bool(value)

    try:
        if pd.isna(value):  # type: ignore[arg-type]
            return None
    except TypeError:
        pass

    return value


def _round_or_none(value: object, digits: int = 3) -> float | None:
    safe_value = _json_safe(value)
    if safe_value is None:
        return None
    return round(float(safe_value), digits)


def _looks_like_date_column(column_name: str, series: pd.Series) -> bool:
    normalized_name = column_name.lower()
    if any(keyword in normalized_name for keyword in ("date", "time", "day", "month", "year")):
        return True

    sample = series.dropna().astype(str).head(12)
    if sample.empty:
        return False

    date_like_pattern = r"(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,4})|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})"
    date_like_ratio = sample.str.contains(date_like_pattern, regex=True).mean()
    return bool(date_like_ratio >= 0.7)


def _build_preview(df: pd.DataFrame, limit: int = 5) -> list[dict[str, object]]:
    preview_df = _get_user_visible_dataframe(df).head(limit).copy()
    preview_df = preview_df.where(pd.notna(preview_df), None)
    return _json_safe(preview_df.to_dict(orient="records"))  # type: ignore[return-value]


def _is_internal_column(column: object) -> bool:
    return str(column).startswith(INTERNAL_COLUMN_PREFIX)


def _get_user_visible_columns(df: pd.DataFrame) -> list[str]:
    return [column for column in df.columns if not _is_internal_column(column)]


def _get_user_visible_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    return df.loc[:, _get_user_visible_columns(df)].copy()


def _safe_export_filename(filename: object, suffix: str) -> str:
    stem = str(filename or "atlas_dataset").rsplit(".", 1)[0]
    safe_stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_") or "atlas_dataset"
    return f"{safe_stem}_{suffix}.csv"


def _safe_display_filename(filename: object) -> str:
    name = str(filename or "").strip().replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\r\n\t]+", " ", name).strip()
    name = re.sub(r"[<>:\"/\\|?*]+", "_", name).strip(" ._")
    if not name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")
    return name[:180]


def _build_full_dataset(df: pd.DataFrame) -> dict[str, object]:
    full_df = _get_user_visible_dataframe(df)
    full_df = full_df.where(pd.notna(full_df), None)

    return {
        "columns": list(full_df.columns),
        "rows": _json_safe(full_df.to_dict(orient="records")),
        "total_rows": int(full_df.shape[0]),
        "total_columns": int(full_df.shape[1]),
    }


def _estimate_dataframe_size_bytes(df: pd.DataFrame) -> int:
    return int(_get_user_visible_dataframe(df).memory_usage(deep=True).sum())


def _build_profile(df: pd.DataFrame, preview_limit: int = 5) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    column_profiles: list[dict[str, object]] = []
    basic_statistics: list[dict[str, object]] = []

    for column in df.columns:
        series = df[column]
        missing_values = int(series.isna().sum())
        non_null_values = int(series.notna().sum())
        profile: dict[str, object] = {
            "name": column,
            "dtype": str(series.dtype),
            "missing_values": missing_values,
            "missing_percent": _round_or_none((missing_values / len(series)) * 100 if len(series) else 0, 2),
            "non_null_values": non_null_values,
            "unique_values": int(series.nunique(dropna=True)),
        }

        if pd.api.types.is_numeric_dtype(series):
            non_null_series = series.dropna()
            stats = {
                "count": non_null_values,
                "sum": _round_or_none(non_null_series.sum()) if non_null_values else None,
                "mean": _round_or_none(series.mean()),
                "median": _round_or_none(series.median()),
                "min": _round_or_none(series.min()),
                "max": _round_or_none(series.max()),
                "std": _round_or_none(series.std()),
            }
            profile["statistics"] = stats
            basic_statistics.append({"column": column, **stats})
        elif pd.api.types.is_datetime64_any_dtype(series):
            non_null_series = series.dropna()
            profile["statistics"] = {
                "earliest": _json_safe(non_null_series.min()) if not non_null_series.empty else None,
                "latest": _json_safe(non_null_series.max()) if not non_null_series.empty else None,
            }
        else:
            values = series.dropna().astype(str)
            if not values.empty:
                top_value = values.value_counts().head(1)
                label, count = next(iter(top_value.items()))
                profile["most_frequent"] = {"label": label, "count": int(count)}

        column_profiles.append(profile)

    return {
        "rows": int(df.shape[0]),
        "columns_count": int(df.shape[1]),
        "columns": list(df.columns),
        "column_profiles": column_profiles,
        "basic_statistics": basic_statistics,
        "preview": _build_preview(df, limit=preview_limit),
    }


def _build_table_page(df: pd.DataFrame, page: int, page_size: int) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    total_rows = int(df.shape[0])
    total_pages = max((total_rows + page_size - 1) // page_size, 1)
    safe_page = min(page, total_pages)

    start_index = (safe_page - 1) * page_size
    end_index = min(start_index + page_size, total_rows)

    page_df = df.iloc[start_index:end_index].copy()
    page_df = page_df.where(pd.notna(page_df), None)

    return {
        "columns": list(df.columns),
        "rows": _json_safe(page_df.to_dict(orient="records")),
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total_rows": total_rows,
            "total_pages": total_pages,
            "start_row": start_index + 1 if total_rows > 0 else 0,
            "end_row": end_index,
            "has_previous": safe_page > 1,
            "has_next": safe_page < total_pages,
        },
    }


def _get_dataset(dataset_id: str) -> dict[str, object]:
    dataset = DATASETS.get(dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


def _select_dataframe(dataset: dict[str, object], stage: str) -> tuple[pd.DataFrame, str]:
    normalized_stage = stage.lower().strip()
    raw_df = dataset["raw"]
    cleaned_df = dataset.get("cleaned")

    if not isinstance(raw_df, pd.DataFrame):    
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    if normalized_stage == "raw":
        return raw_df, "raw"

    if normalized_stage == "cleaned":
        if not isinstance(cleaned_df, pd.DataFrame):
            raise HTTPException(status_code=400, detail="Dataset has not been cleaned yet")
        return cleaned_df, "cleaned"

    if normalized_stage == "latest":
        if isinstance(cleaned_df, pd.DataFrame):
            return cleaned_df, "cleaned"
        return raw_df, "raw"

    raise HTTPException(status_code=400, detail="Invalid stage. Use raw, cleaned, or latest")


DEFAULT_CLEANING_CONFIG: dict[str, object] = {
    "normalize_placeholder_nulls": True,
    "standardize_text": True,
    "convert_datetime_columns": True,
    "convert_numeric_columns": True,
    "validate_emails": True,
    "validate_numeric_ranges": True,
    "validate_future_dates": True,
    "drop_all_null_rows": True,
    "remove_duplicates": True,
    "flag_duplicate_keys": True,
    "flag_required_missing": True,
    "drop_critical_missing": True,
    "fill_numeric_missing": True,
    "fill_datetime_missing": True,
    "placeholder_null_tokens": tuple(NULL_TEXT_TOKENS),
    "critical_keywords": ("id", "email"),
    "required_keywords": (),
    "date_keywords": ("date", "time", "created", "updated", "timestamp"),
    "name_label_keywords": ("name", "label", "city", "department"),
    "protected_text_keywords": ("email", "username", "id", "code", "acronym"),
    "future_date_keywords": ("birth", "dob"),
    "numeric_range_rules": {"age": {"min": 0}},
    "fill_text_with_mode": False,
    "required_missing_drop_threshold": None,
    "datetime_parse_ratio": 0.65,
    "numeric_like_ratio": 0.8,
    "numeric_skew_threshold": 1.0,
}


def _normalize_column_name(column_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(column_name).lower()).strip("_")


def _column_matches_keywords(column_name: str, keywords: tuple[str, ...]) -> bool:
    normalized = _normalize_column_name(column_name)
    tokens = set(normalized.split("_"))

    for keyword in keywords:
        normalized_keyword = _normalize_column_name(keyword)
        if normalized_keyword in tokens or normalized == normalized_keyword:
            return True
        if "_" in normalized_keyword and normalized_keyword in normalized:
            return True

    return False


def _sanitize_numeric_strings(series: pd.Series) -> pd.Series:
    return (
        series.astype("string")
        .str.replace(",", "", regex=False)
        .str.replace(r"[\$€£₱]", "", regex=True)
        .str.replace(r"\s+", "", regex=True)
    )


def _is_sequential_datetime(series: pd.Series) -> bool:
    non_null = series.dropna()
    if len(non_null) < 3:
        return False
    return bool(non_null.is_monotonic_increasing)


def _clean_dataframe(
    df: pd.DataFrame,
    config: dict[str, object] | None = None,
) -> tuple[pd.DataFrame, dict[str, object]]:
    cleaning_config = {**DEFAULT_CLEANING_CONFIG, **(config or {})}
    cleaned_df = df.copy()
    rows_before = int(cleaned_df.shape[0])
    missing_before = int(cleaned_df.isna().sum().sum())

    placeholder_tokens = {
        str(token).strip().lower()
        for token in cleaning_config["placeholder_null_tokens"]  # type: ignore[index]
    }
    critical_keywords = tuple(cleaning_config["critical_keywords"])  # type: ignore[arg-type]
    required_keywords = tuple(cleaning_config["required_keywords"])  # type: ignore[arg-type]
    protected_keywords = tuple(cleaning_config["protected_text_keywords"])  # type: ignore[arg-type]
    date_keywords = tuple(cleaning_config["date_keywords"])  # type: ignore[arg-type]
    name_label_keywords = tuple(cleaning_config["name_label_keywords"])  # type: ignore[arg-type]
    future_date_keywords = tuple(cleaning_config["future_date_keywords"])  # type: ignore[arg-type]
    should_normalize_nulls = bool(cleaning_config["normalize_placeholder_nulls"])
    should_standardize_text = bool(cleaning_config["standardize_text"])
    should_convert_datetimes = bool(cleaning_config["convert_datetime_columns"])
    should_convert_numeric = bool(cleaning_config["convert_numeric_columns"])
    should_validate_emails = bool(cleaning_config["validate_emails"])
    should_validate_numeric_ranges = bool(cleaning_config["validate_numeric_ranges"])
    should_validate_future_dates = bool(cleaning_config["validate_future_dates"])
    should_drop_all_null_rows = bool(cleaning_config["drop_all_null_rows"])
    should_remove_duplicates = bool(cleaning_config["remove_duplicates"])
    should_flag_duplicate_keys = bool(cleaning_config["flag_duplicate_keys"])
    should_flag_required_missing = bool(cleaning_config["flag_required_missing"])
    should_drop_critical_missing = bool(cleaning_config["drop_critical_missing"])
    should_fill_numeric_missing = bool(cleaning_config["fill_numeric_missing"])
    should_fill_datetime_missing = bool(cleaning_config["fill_datetime_missing"])
    should_fill_text_with_mode = bool(cleaning_config["fill_text_with_mode"])

    row_issues: dict[object, set[str]] = {}
    validation_errors: list[dict[str, object]] = []

    rows_dropped = {
        "all_null": 0,
        "critical_missing": 0,
        "required_threshold": 0,
        "total": 0,
    }
    flagged_counts = {
        "missing_required": 0,
        "duplicate_primary_key": 0,
        "validation": 0,
        "conversion": 0,
    }

    def _flag_rows(mask: pd.Series, issue: str, column: str | None = None) -> int:
        flagged_indexes = list(mask[mask].index)
        for row_index in flagged_indexes:
            row_issues.setdefault(row_index, set()).add(issue if column is None else f"{column}: {issue}")
        return len(flagged_indexes)

    def _add_validation_error(column: str, issue: str, rows: int) -> None:
        if rows > 0:
            validation_errors.append({"column": column, "issue": issue, "rows": int(rows)})

    def _is_protected_text_column(column_name: str) -> bool:
        return _column_matches_keywords(column_name, protected_keywords)

    def _is_title_case_column(column_name: str) -> bool:
        return _column_matches_keywords(column_name, name_label_keywords) and not _is_protected_text_column(column_name)

    cleaned_df = cleaned_df.replace([np.inf, -np.inf], np.nan)

    # Rule 1: normalize only explicit placeholder tokens into nulls.
    nulls_normalized = 0
    standardized_text_columns: list[str] = []
    if should_normalize_nulls or should_standardize_text:
        for column in list(cleaned_df.select_dtypes(include=["object", "string"]).columns):
            original_series = cleaned_df[column].astype("string")
            normalized_series = original_series
            if should_normalize_nulls or should_standardize_text:
                normalized_series = normalized_series.str.strip().str.replace(r"\s+", " ", regex=True)

            if should_normalize_nulls:
                placeholder_mask = normalized_series.fillna("").str.lower().isin(placeholder_tokens)
                normalized_series = normalized_series.mask(placeholder_mask, pd.NA)

            if should_standardize_text and _is_title_case_column(str(column)):
                normalized_series = normalized_series.str.title()

            nulls_normalized += max(int(normalized_series.isna().sum()) - int(original_series.isna().sum()), 0)
            if should_standardize_text and not original_series.equals(normalized_series):
                standardized_text_columns.append(str(column))

            cleaned_df[column] = normalized_series

    converted_columns: list[dict[str, str]] = []

    # Rule 3: convert trusted date-like columns, coercing unparseable values to null and flagging them.
    if should_convert_datetimes:
        for column in list(cleaned_df.columns):
            column_name = str(column)
            if not _column_matches_keywords(column_name, date_keywords):
                continue
            if pd.api.types.is_datetime64_any_dtype(cleaned_df[column]):
                continue

            source_non_null = int(cleaned_df[column].notna().sum())
            if source_non_null == 0:
                continue

            converted_series = pd.to_datetime(cleaned_df[column], errors="coerce")
            parse_ratio = float(converted_series.notna().sum()) / float(source_non_null)
            if parse_ratio < float(cleaning_config["datetime_parse_ratio"]):
                continue

            failed_mask = cleaned_df[column].notna() & converted_series.isna()
            failed_rows = _flag_rows(failed_mask, "invalid datetime nullified", column_name)
            flagged_counts["conversion"] += failed_rows
            _add_validation_error(column_name, "invalid datetime values were nullified", failed_rows)

            cleaned_df[column] = converted_series
            converted_columns.append({"column": column_name, "to_type": "datetime", "new_dtype": str(cleaned_df[column].dtype)})

    # Rule 3: convert numeric-like text only when most non-null values parse safely.
    if should_convert_numeric:
        for column in list(cleaned_df.select_dtypes(include=["object", "string"]).columns):
            column_name = str(column)
            if _is_protected_text_column(column_name):
                continue

            non_null_values = cleaned_df[column].dropna()
            if non_null_values.empty:
                continue

            sanitized_values = _sanitize_numeric_strings(non_null_values)
            parsed_values = pd.to_numeric(sanitized_values, errors="coerce")
            numeric_like_ratio = float(parsed_values.notna().sum()) / float(len(non_null_values))
            if numeric_like_ratio < float(cleaning_config["numeric_like_ratio"]):
                continue

            sanitized_series = _sanitize_numeric_strings(cleaned_df[column])
            converted_series = pd.to_numeric(sanitized_series, errors="coerce")
            failed_mask = cleaned_df[column].notna() & converted_series.isna()
            failed_rows = _flag_rows(failed_mask, "invalid numeric nullified", column_name)
            flagged_counts["conversion"] += failed_rows
            _add_validation_error(column_name, "invalid numeric values were nullified", failed_rows)

            cleaned_df[column] = converted_series
            converted_columns.append({"column": column_name, "to_type": "numeric", "new_dtype": str(cleaned_df[column].dtype)})

    # Rule 7: validate emails by format, then nullify invalid values instead of correcting them.
    if should_validate_emails:
        for column in [item for item in cleaned_df.columns if _column_matches_keywords(str(item), ("email",))]:
            values = cleaned_df[column].dropna().astype("string")
            if values.empty:
                continue

            valid_mask = values.str.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", na=False)
            invalid_indexes = values.index[~valid_mask]
            if len(invalid_indexes) > 0:
                mask = cleaned_df.index.isin(invalid_indexes)
                invalid_rows = _flag_rows(pd.Series(mask, index=cleaned_df.index), "invalid email nullified", str(column))
                flagged_counts["validation"] += invalid_rows
                _add_validation_error(str(column), "invalid email values were nullified", invalid_rows)
                cleaned_df.loc[invalid_indexes, column] = pd.NA

    # Rule 7: enforce configured numeric ranges such as age >= 0.
    numeric_range_rules = cleaning_config["numeric_range_rules"]  # type: ignore[index]
    if should_validate_numeric_ranges and isinstance(numeric_range_rules, dict):
        for rule_keyword, rule in numeric_range_rules.items():
            if not isinstance(rule, dict):
                continue
            for column in [item for item in cleaned_df.columns if _column_matches_keywords(str(item), (str(rule_keyword),))]:
                if not pd.api.types.is_numeric_dtype(cleaned_df[column]):
                    continue
                invalid_mask = pd.Series(False, index=cleaned_df.index)
                if "min" in rule:
                    invalid_mask = invalid_mask | (cleaned_df[column] < rule["min"])
                if "max" in rule:
                    invalid_mask = invalid_mask | (cleaned_df[column] > rule["max"])
                invalid_mask = invalid_mask.fillna(False)
                invalid_rows = _flag_rows(invalid_mask, "numeric range violation nullified", str(column))
                if invalid_rows > 0:
                    flagged_counts["validation"] += invalid_rows
                    _add_validation_error(str(column), "numeric range violations were nullified", invalid_rows)
                    cleaned_df.loc[invalid_mask, column] = np.nan

    # Rule 7: do not allow future birthdates; flag and nullify instead.
    today = pd.Timestamp(datetime.now(timezone.utc).date())
    if should_validate_future_dates:
        for column in [item for item in cleaned_df.columns if _column_matches_keywords(str(item), future_date_keywords)]:
            if not pd.api.types.is_datetime64_any_dtype(cleaned_df[column]):
                continue
            invalid_mask = (cleaned_df[column] > today).fillna(False)
            invalid_rows = _flag_rows(invalid_mask, "future date nullified", str(column))
            if invalid_rows > 0:
                flagged_counts["validation"] += invalid_rows
                _add_validation_error(str(column), "future date values were nullified", invalid_rows)
                cleaned_df.loc[invalid_mask, column] = pd.NaT

    # Rule 6: remove rows with no usable data.
    if should_drop_all_null_rows:
        all_null_mask = cleaned_df.isna().all(axis=1)
        rows_dropped["all_null"] = int(all_null_mask.sum())
        if rows_dropped["all_null"] > 0:
            cleaned_df = cleaned_df.loc[~all_null_mask].copy()

    # Rule 4: remove fully duplicated rows only.
    duplicates_removed = 0
    if should_remove_duplicates:
        rows_before_deduplication = int(cleaned_df.shape[0])
        cleaned_df = cleaned_df.drop_duplicates()
        duplicates_removed = rows_before_deduplication - int(cleaned_df.shape[0])

    # Rule 4: duplicate primary keys are flagged, not deleted.
    key_columns = [
        column
        for column in cleaned_df.columns
        if _column_matches_keywords(str(column), ("id", "email", "username", "primary_key", "primarykey"))
    ]
    duplicate_key_columns: list[str] = []
    duplicate_key_row_indexes: set[object] = set()
    if should_flag_duplicate_keys:
        for column in key_columns:
            duplicate_mask = cleaned_df[column].notna() & cleaned_df[column].duplicated(keep=False)
            duplicate_rows = _flag_rows(duplicate_mask, "duplicate primary key flagged", str(column))
            if duplicate_rows > 0:
                flagged_counts["duplicate_primary_key"] += duplicate_rows
                duplicate_key_columns.append(str(column))
                duplicate_key_row_indexes.update(duplicate_mask[duplicate_mask].index)

    required_columns = [column for column in cleaned_df.columns if _column_matches_keywords(str(column), required_keywords)]
    missing_required_row_indexes: set[object] = set()
    if should_flag_required_missing and required_columns:
        required_missing_mask = cleaned_df[required_columns].isna()
        missing_required_mask = required_missing_mask.any(axis=1)
        flagged_counts["missing_required"] = _flag_rows(missing_required_mask, "required field missing", None)
        missing_required_row_indexes.update(missing_required_mask[missing_required_mask].index)

        threshold = cleaning_config.get("required_missing_drop_threshold")
        if isinstance(threshold, (int, float)) and 0 < float(threshold) <= 1:
            missing_ratio = required_missing_mask.sum(axis=1) / max(len(required_columns), 1)
            threshold_drop_mask = missing_ratio > float(threshold)
            rows_dropped["required_threshold"] = int(threshold_drop_mask.sum())
            if rows_dropped["required_threshold"] > 0:
                cleaned_df = cleaned_df.loc[~threshold_drop_mask].copy()

    # Rule 2: critical rows are dropped only when trusted identifiers are missing.
    critical_columns = [column for column in cleaned_df.columns if _column_matches_keywords(str(column), critical_keywords)]
    if should_drop_critical_missing and critical_columns:
        critical_missing_mask = cleaned_df[critical_columns].isna().any(axis=1)
        rows_dropped["critical_missing"] = int(critical_missing_mask.sum())
        if rows_dropped["critical_missing"] > 0:
            cleaned_df = cleaned_df.loc[~critical_missing_mask].copy()

    # Rule 2: fill numeric gaps deterministically; choose median for skew/outliers, otherwise mean.
    filled_numeric_mean = 0
    filled_numeric_median = 0
    filled_numeric_columns: list[dict[str, object]] = []
    if should_fill_numeric_missing:
        for column in list(cleaned_df.select_dtypes(include=["number"]).columns):
            column_name = str(column)
            if _is_protected_text_column(column_name) or pd.api.types.is_bool_dtype(cleaned_df[column]):
                continue

            missing_before_fill = int(cleaned_df[column].isna().sum())
            if missing_before_fill == 0:
                continue

            non_null_series = cleaned_df[column].dropna()
            if non_null_series.empty:
                continue

            skew_value = non_null_series.skew()
            use_median = bool(pd.notna(skew_value) and abs(float(skew_value)) > float(cleaning_config["numeric_skew_threshold"]))
            fill_value = non_null_series.median() if use_median else non_null_series.mean()
            if pd.isna(fill_value):
                continue

            cleaned_df[column] = cleaned_df[column].fillna(fill_value)
            filled_count = max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)
            method = "median" if use_median else "mean"
            filled_numeric_columns.append({"column": column_name, "method": method, "filled": int(filled_count)})
            if use_median:
                filled_numeric_median += filled_count
            else:
                filled_numeric_mean += filled_count

    # Rule 2: only forward-fill datetimes when the column is clearly sequential.
    filled_datetime_ffill = 0
    filled_datetime_columns: list[dict[str, object]] = []
    if should_fill_datetime_missing:
        for column in list(cleaned_df.select_dtypes(include=["datetime", "datetimetz"]).columns):
            column_name = str(column)
            if _column_matches_keywords(column_name, future_date_keywords):
                continue
            missing_before_fill = int(cleaned_df[column].isna().sum())
            if missing_before_fill == 0 or not _is_sequential_datetime(cleaned_df[column]):
                continue

            cleaned_df[column] = cleaned_df[column].ffill()
            filled_count = max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)
            filled_datetime_ffill += filled_count
            filled_datetime_columns.append({"column": column_name, "method": "forward_fill", "filled": int(filled_count)})

    # Rule 2: text mode filling is off by default to avoid fabricating human-entered data.
    filled_text_mode = 0
    filled_text_columns: list[dict[str, object]] = []
    if should_fill_text_with_mode:
        for column in list(cleaned_df.select_dtypes(include=["object", "string"]).columns):
            if _is_protected_text_column(str(column)):
                continue
            missing_before_fill = int(cleaned_df[column].isna().sum())
            if missing_before_fill == 0:
                continue

            mode_values = cleaned_df[column].mode(dropna=True)
            if mode_values.empty:
                continue

            cleaned_df[column] = cleaned_df[column].fillna(mode_values.iloc[0])
            filled_count = max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)
            filled_text_mode += filled_count
            filled_text_columns.append({"column": str(column), "method": "mode", "filled": int(filled_count)})

    existing_indexes = set(cleaned_df.index)
    flagged_row_indexes = {index for index, issues in row_issues.items() if issues and index in existing_indexes}
    if flagged_row_indexes:
        cleaned_df["_atlas_flags"] = [
            "; ".join(sorted(row_issues.get(row_index, set()))) or None for row_index in cleaned_df.index
        ]
        cleaned_df["_atlas_has_flag"] = [row_index in flagged_row_indexes for row_index in cleaned_df.index]
        cleaned_df["_atlas_missing_required_flag"] = [
            row_index in missing_required_row_indexes for row_index in cleaned_df.index
        ]
        cleaned_df["_atlas_duplicate_primary_key_flag"] = [
            row_index in duplicate_key_row_indexes for row_index in cleaned_df.index
        ]

    missing_after = int(_get_user_visible_dataframe(cleaned_df).isna().sum().sum())
    rows_dropped["total"] = int(rows_dropped["all_null"] + rows_dropped["critical_missing"] + rows_dropped["required_threshold"])
    total_filled = filled_numeric_mean + filled_numeric_median + filled_text_mode + filled_datetime_ffill

    def _cleaning_step(
        name: str,
        enabled: bool,
        impact_count: int,
        handling: str,
        rationale: str,
    ) -> dict[str, object]:
        return {
            "name": name,
            "enabled": enabled,
            "impact_count": int(impact_count),
            "handling": handling if enabled else "Skipped",
            "rationale": rationale,
        }

    cleaning_steps = [
        _cleaning_step(
            "Normalize placeholder nulls",
            should_normalize_nulls,
            nulls_normalized,
            "Converted explicit placeholders to null",
            "Blank, NA, null, unknown, and dash values should be measured as missing data.",
        ),
        _cleaning_step(
            "Standardize text formats",
            should_standardize_text,
            len(standardized_text_columns),
            "Trimmed spacing and title-cased name or label columns",
            "Consistent labels improve grouping, filtering, and dashboard readability.",
        ),
        _cleaning_step(
            "Convert data types",
            should_convert_datetimes or should_convert_numeric,
            len(converted_columns),
            "Converted trusted date-like and numeric-like columns",
            "Typed columns unlock valid statistics, comparisons, and chart aggregation.",
        ),
        _cleaning_step(
            "Remove duplicate rows",
            should_remove_duplicates,
            duplicates_removed,
            "Removed only fully duplicated records",
            "Exact duplicates can double-count metrics without adding new information.",
        ),
        _cleaning_step(
            "Handle missing values",
            should_fill_numeric_missing or should_fill_datetime_missing or should_fill_text_with_mode,
            total_filled,
            "Filled numeric/date gaps using deterministic methods",
            "Numeric gaps use mean or median while human-entered text stays null unless mode fill is enabled.",
        ),
        _cleaning_step(
            "Filter invalid records",
            should_drop_all_null_rows or should_drop_critical_missing,
            rows_dropped["total"],
            "Dropped all-null rows and rows missing critical identifiers",
            "Rows without usable data or trusted identifiers are not reliable for analysis.",
        ),
        _cleaning_step(
            "Validate invalid values",
            should_validate_emails or should_validate_numeric_ranges or should_validate_future_dates,
            flagged_counts["validation"] + flagged_counts["conversion"],
            "Flagged or nullified invalid email, date, and numeric values",
            "Invalid values are safer to mark than silently correct with a guess.",
        ),
        _cleaning_step(
            "Flag review items",
            should_flag_duplicate_keys or should_flag_required_missing,
            len(flagged_row_indexes),
            "Kept suspicious rows with audit flags",
            "Possible duplicate keys or required-field gaps need review but may still contain usable data.",
        ),
    ]

    audit_log = {
        "nulls_normalized": int(nulls_normalized),
        "cleaning_steps": cleaning_steps,
        "rows_dropped": rows_dropped,
        "duplicates_removed": int(duplicates_removed),
        "filled_numeric_values": {
            "mean": int(filled_numeric_mean),
            "median": int(filled_numeric_median),
            "total": int(filled_numeric_mean + filled_numeric_median),
            "columns": filled_numeric_columns,
        },
        "filled_text_values": {
            "mode": int(filled_text_mode),
            "total": int(filled_text_mode),
            "columns": filled_text_columns,
            "policy": "mode fill enabled" if should_fill_text_with_mode else "preserve nulls by default",
        },
        "filled_datetime_values": {
            "forward_fill": int(filled_datetime_ffill),
            "columns": filled_datetime_columns,
        },
        "converted_columns": converted_columns,
        "flagged_rows": {
            "total": int(len(flagged_row_indexes)),
            "missing_required": int(flagged_counts["missing_required"]),
            "duplicate_primary_key": int(flagged_counts["duplicate_primary_key"]),
            "validation": int(flagged_counts["validation"]),
            "conversion": int(flagged_counts["conversion"]),
        },
        "validation_errors": validation_errors,
        "flag_columns": {
            "flags": "_atlas_flags",
            "has_flag": "_atlas_has_flag",
            "missing_required": "_atlas_missing_required_flag",
            "duplicate_primary_key": "_atlas_duplicate_primary_key_flag",
        },
        "config": {
            "normalize_placeholder_nulls": should_normalize_nulls,
            "standardize_text": should_standardize_text,
            "convert_datetime_columns": should_convert_datetimes,
            "convert_numeric_columns": should_convert_numeric,
            "validate_emails": should_validate_emails,
            "validate_numeric_ranges": should_validate_numeric_ranges,
            "validate_future_dates": should_validate_future_dates,
            "drop_all_null_rows": should_drop_all_null_rows,
            "remove_duplicates": should_remove_duplicates,
            "flag_duplicate_keys": should_flag_duplicate_keys,
            "flag_required_missing": should_flag_required_missing,
            "drop_critical_missing": should_drop_critical_missing,
            "fill_numeric_missing": should_fill_numeric_missing,
            "fill_datetime_missing": should_fill_datetime_missing,
            "fill_text_with_mode": should_fill_text_with_mode,
            "critical_keywords": list(critical_keywords),
            "required_keywords": list(required_keywords),
            "required_missing_drop_threshold": cleaning_config["required_missing_drop_threshold"],
            "numeric_skew_threshold": cleaning_config["numeric_skew_threshold"],
        },
    }

    summary = {
        "rows_before": rows_before,
        "rows_after": int(cleaned_df.shape[0]),
        "duplicates_removed": int(duplicates_removed),
        "invalid_rows_removed": int(rows_dropped["total"]),
        "missing_values_before": missing_before,
        "missing_values_after": missing_after,
        "missing_values_filled": int(total_filled),
        "filled_numeric_mean": int(filled_numeric_mean),
        "filled_numeric_median": int(filled_numeric_median),
        "filled_text_mode": int(filled_text_mode),
        "filled_datetime_ffill": int(filled_datetime_ffill),
        "converted_columns": converted_columns,
        "date_columns_converted": [item["column"] for item in converted_columns if item["to_type"] == "datetime"],
        "numeric_columns_converted": [item["column"] for item in converted_columns if item["to_type"] == "numeric"],
        "text_columns_standardized": standardized_text_columns,
        "nulls_normalized": int(nulls_normalized),
        "rows_dropped": rows_dropped,
        "filled_numeric_values": audit_log["filled_numeric_values"],
        "filled_text_values": audit_log["filled_text_values"],
        "flagged_rows": audit_log["flagged_rows"],
        "validation_errors": validation_errors,
        "cleaning_steps": cleaning_steps,
        "audit_log": audit_log,
        "duplicate_primary_key_columns": duplicate_key_columns,
        "config_applied": audit_log["config"],
        "data_integrity_policy": "ATLAS uses configurable cleaning rules and avoids guessing unknown human-entered values unless mode fill is enabled.",
    }
    return cleaned_df, summary


def _build_analysis(df: pd.DataFrame) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    numeric_columns = list(df.select_dtypes(include=["number"]).columns)
    categorical_columns = list(
        df.select_dtypes(exclude=["number", "datetime", "datetimetz"]).columns
    )

    numeric_summary: list[dict[str, object]] = []
    for column in numeric_columns:
        series = df[column]
        non_null_series = series.dropna()
        numeric_summary.append(
            {
                "column": column,
                "sum": _round_or_none(non_null_series.sum()) if not non_null_series.empty else None,
                "mean": _round_or_none(series.mean()),
                "median": _round_or_none(series.median()),
                "min": _round_or_none(series.min()),
                "max": _round_or_none(series.max()),
                "std": _round_or_none(series.std()),
            }
        )

    top_frequencies: list[dict[str, object]] = []
    for column in categorical_columns[:5]:
        values = df[column].dropna().astype(str)
        if values.empty:
            continue

        counts = values.value_counts().head(5)
        top_frequencies.append(
            {
                "column": column,
                "values": [
                    {"label": label, "count": int(count)} for label, count in counts.items()
                ],
            }
        )

    correlation_matrix: list[dict[str, object]] = []
    if len(numeric_columns) >= 2:
        correlations = df[numeric_columns].corr(numeric_only=True)
        for source_column in correlations.columns:
            row: dict[str, float] = {}
            for target_column in correlations.columns:
                if source_column == target_column:
                    continue

                value = _round_or_none(correlations.loc[source_column, target_column])
                if value is not None:
                    row[target_column] = value

            if row:
                correlation_matrix.append({"column": source_column, "correlations": row})

    return {
        "numeric_summary": numeric_summary,
        "top_frequencies": top_frequencies,
        "correlation_matrix": correlation_matrix,
    }


def _find_ai_date_column(df: pd.DataFrame) -> tuple[str | None, pd.Series | None]:
    for column in df.columns:
        series = df[column]
        if pd.api.types.is_datetime64_any_dtype(series):
            return str(column), pd.to_datetime(series, errors="coerce")

    for column in df.columns:
        series = df[column]
        if not _looks_like_date_column(str(column), series):
            continue

        parsed = pd.to_datetime(series, errors="coerce")
        if len(parsed) and float(parsed.notna().mean()) >= 0.45:
            return str(column), parsed

    return None, None


def _build_ai_trends(df: pd.DataFrame, numeric_summary: list[dict[str, object]]) -> dict[str, str]:
    df = _get_user_visible_dataframe(df)
    numeric_columns = [
        str(summary["column"])
        for summary in numeric_summary
        if summary.get("column") in df.columns
    ]
    date_column, date_series = _find_ai_date_column(df)
    trends: dict[str, str] = {}

    for column in numeric_columns[:3]:
        values = pd.to_numeric(df[column], errors="coerce")
        trend_df = pd.DataFrame({"value": values})

        if date_series is not None:
            trend_df["date"] = date_series
            trend_df = trend_df.dropna(subset=["value", "date"]).sort_values("date")
        else:
            trend_df = trend_df.dropna(subset=["value"])

        if len(trend_df) < 2:
            continue

        window_size = max(1, min(10, len(trend_df) // 5 or 1))
        first_average = float(trend_df["value"].head(window_size).mean())
        last_average = float(trend_df["value"].tail(window_size).mean())
        difference = last_average - first_average

        if abs(difference) < 1e-9:
            direction = "mostly flat"
        else:
            direction = "upward" if difference > 0 else "downward"

        if first_average:
            percent_change = (difference / abs(first_average)) * 100
            change_note = f"latest values are {abs(percent_change):.1f}% {'higher' if percent_change > 0 else 'lower'} than the first values"
        else:
            change_note = f"changed from {first_average:.2f} to {last_average:.2f}"

        if date_column:
            trends[column] = f"{direction} trend across {date_column}; {change_note}"
        else:
            trends[column] = f"{direction} trend by row order; {change_note}"

    return trends


def _build_gemini_dataset_summary(
    dataset: dict[str, object],
    df: pd.DataFrame,
    resolved_stage: str,
) -> dict[str, object]:
    visible_df = _get_user_visible_dataframe(df).replace([np.inf, -np.inf], np.nan)
    analysis = _build_analysis(visible_df)
    numeric_summary_items = analysis.get("numeric_summary", [])
    numeric_summary: dict[str, dict[str, object]] = {}

    if isinstance(numeric_summary_items, list):
        for item in numeric_summary_items[:10]:
            if not isinstance(item, dict) or not item.get("column"):
                continue

            column = str(item["column"])
            numeric_summary[column] = {
                "sum": item.get("sum"),
                "avg": item.get("mean"),
                "min": item.get("min"),
                "max": item.get("max"),
            }

    categorical_summary: dict[str, dict[str, object]] = {}
    top_frequencies = analysis.get("top_frequencies", [])
    if isinstance(top_frequencies, list):
        for item in top_frequencies[:8]:
            if not isinstance(item, dict) or not item.get("column"):
                continue

            values = item.get("values") if isinstance(item.get("values"), list) else []
            distribution = {
                str(value.get("label")): int(value.get("count") or 0)
                for value in values[:5]
                if isinstance(value, dict) and value.get("label") is not None
            }
            categorical_summary[str(item["column"])] = {
                "top": next(iter(distribution.keys()), None),
                "distribution": distribution,
            }

    missing_by_column = [
        {"column": str(column), "missing_values": int(count)}
        for column, count in visible_df.isna().sum().sort_values(ascending=False).head(8).items()
        if int(count) > 0
    ]
    cleaning_summary = dataset.get("cleaning_summary")
    cleaning_summary = cleaning_summary if isinstance(cleaning_summary, dict) else {}

    return _json_safe(
        {
            "dataset_name": dataset.get("filename") or "dataset",
            "stage": resolved_stage,
            "total_rows": int(visible_df.shape[0]),
            "total_columns": int(visible_df.shape[1]),
            "columns": [str(column) for column in visible_df.columns],
            "numeric_summary": numeric_summary,
            "categorical_summary": categorical_summary,
            "trends": _build_ai_trends(visible_df, numeric_summary_items if isinstance(numeric_summary_items, list) else []),
            "data_quality": {
                "missing_values": int(visible_df.isna().sum().sum()) if visible_df.shape[1] else 0,
                "missing_by_column": missing_by_column,
                "duplicate_rows": int(visible_df.duplicated().sum()) if not visible_df.empty else 0,
                "duplicates_removed": int(cleaning_summary.get("duplicates_removed") or 0),
                "invalid_rows_removed": int(cleaning_summary.get("invalid_rows_removed") or 0),
                "missing_values_filled": int(cleaning_summary.get("missing_values_filled") or 0),
            },
        }
    )


def _build_ai_summary_cache_key(summary: dict[str, object]) -> str:
    summary_json = json.dumps(
        {
            "version": AI_INSIGHTS_CACHE_VERSION,
            "summary": summary,
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(summary_json.encode("utf-8")).hexdigest()


def _build_gemini_prompt(summary: dict[str, object]) -> str:
    dataset_name = summary.get("dataset_name") or "this dataset"
    return (
        f"You are a friendly data analyst explaining {dataset_name} to a non-technical user. "
        "Analyze only the structured dataset summary below. Do not mention that you received a JSON summary, "
        "do not show code, and do not output raw JSON inside any sentence.\n\n"
        "Write polished, human-readable insights that sound like an analyst report. "
        "Start by explaining what the dataset appears to be about based on its columns and summaries. "
        "Use phrases like 'Based on this, we can conclude...' only when the data supports the conclusion. "
        "Keep the tone clear, helpful, and specific to the dataset.\n\n"
        "Return valid JSON that matches the provided schema. Each array must contain 2 to 4 complete sentences. "
        "Every sentence must be plain language, not a fragment, and should include concrete column names or values when useful.\n\n"
        f"Dataset summary:\n{json.dumps(summary, indent=2, ensure_ascii=False)}"
    )


def _get_gemini_model_candidates(primary_model: str) -> list[str]:
    raw_fallbacks = os.getenv("GEMINI_FALLBACK_MODELS") or ",".join(GEMINI_DEFAULT_FALLBACK_MODELS)
    candidates = [primary_model, *(model.strip() for model in raw_fallbacks.split(","))]
    unique_candidates: list[str] = []

    for candidate in candidates:
        if candidate and candidate not in unique_candidates:
            unique_candidates.append(candidate)

    return unique_candidates or [GEMINI_DEFAULT_MODEL]


def _extract_gemini_error_detail(status_code: int, response_body: str) -> str:
    fallback = f"Gemini API returned HTTP {status_code}. Try again later."

    try:
        payload = json.loads(response_body)
    except json.JSONDecodeError:
        return fallback

    if not isinstance(payload, dict):
        return fallback

    error_payload = payload.get("error")
    if not isinstance(error_payload, dict):
        return fallback

    message = str(error_payload.get("message") or "").strip()
    status = str(error_payload.get("status") or "").strip()
    provider_code = error_payload.get("code") or status_code
    prefix = f"Gemini API error {provider_code}"
    if status:
        prefix = f"{prefix} {status}"

    if not message:
        return f"{prefix}. Try again later."

    return f"{prefix}: {message[:500]}"


def _post_gemini_generate_content(
    model: str,
    api_key: str,
    payload: dict[str, object],
) -> dict[str, object]:
    request = urllib.request.Request(
        GEMINI_API_URL_TEMPLATE.format(model=model),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise GeminiAPIError(
            _extract_gemini_error_detail(exc.code, response_body),
            provider_status_code=exc.code,
            retryable=exc.code in {429, 500, 502, 503, 504},
        ) from exc
    except (TimeoutError, OSError, urllib.error.URLError) as exc:
        raise GeminiAPIError(
            "Unable to reach Gemini API right now. Try again in a moment.",
            retryable=True,
        ) from exc

    try:
        response_payload = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an unreadable response. Try again later.",
        ) from exc

    if not isinstance(response_payload, dict):
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an unreadable response. Try again later.",
        )

    return response_payload


def _extract_gemini_text(payload: dict[str, object]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return ""

    content = first_candidate.get("content")
    if not isinstance(content, dict):
        return ""

    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""

    text_parts = [
        str(part.get("text"))
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ]
    return "\n".join(text_parts).strip()


def _strip_json_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _section_to_strings(value: object) -> list[str]:
    if isinstance(value, list):
        items: list[str] = []
        for item in value:
            if isinstance(item, (dict, list)):
                nested_items = _section_to_strings(item)
                items.extend(nested_items)
                continue

            text = _clean_ai_sentence(str(item))
            if text:
                items.append(text)
        return items

    if isinstance(value, dict):
        items: list[str] = []
        for key, item in value.items():
            if isinstance(item, list):
                for nested_item in item:
                    text = _clean_ai_sentence(str(nested_item))
                    if text:
                        items.append(f"{key}: {text}")
            else:
                text = _clean_ai_sentence(str(item))
                if text:
                    items.append(f"{key}: {text}")
        return items

    if isinstance(value, str):
        parsed_value = _parse_jsonish_text(value)
        if isinstance(parsed_value, (dict, list)):
            nested_items = _section_to_strings(parsed_value)
            if nested_items:
                return nested_items

        lines = [
            _clean_ai_sentence(re.sub(r"^\s*(?:[-*]|\d+[.)])\s*", "", line))
            for line in value.splitlines()
        ]
        return [line for line in lines if line]

    return []


def _clean_ai_sentence(text: str) -> str:
    cleaned = _strip_json_fence(str(text))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.strip("` \t\r\n")
    return cleaned


def _parse_jsonish_text(text: str) -> object:
    cleaned = _strip_json_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return {}
    return {}


def _get_case_insensitive_value(parsed: dict[str, object], *keys: str) -> object:
    normalized_map = {
        re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_"): value
        for key, value in parsed.items()
    }

    for key in keys:
        normalized_key = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
        if normalized_key in normalized_map:
            return normalized_map[normalized_key]

    return None


def _looks_like_insights_object(parsed: object) -> bool:
    if not isinstance(parsed, dict):
        return False

    insight_keys = {
        "key_insights",
        "key_insight",
        "key insights",
        "insights",
        "summary",
        "trends",
        "trend",
        "data_quality_notes",
        "data quality notes",
        "data_quality",
        "simple_recommendations",
        "simple recommendations",
        "recommendations",
    }
    normalized_keys = {
        re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")
        for key in parsed
    }
    normalized_insight_keys = {
        re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
        for key in insight_keys
    }
    return bool(normalized_keys & normalized_insight_keys)


def _unwrap_nested_insights_object(parsed: dict[str, object]) -> dict[str, object]:
    if _looks_like_insights_object(parsed):
        for value in parsed.values():
            candidate_text = ""
            if isinstance(value, str):
                candidate_text = value
            elif (
                isinstance(value, list)
                and len(value) == 1
                and isinstance(value[0], str)
            ):
                candidate_text = value[0]

            if not candidate_text:
                continue

            nested = _parse_jsonish_text(candidate_text)
            if _looks_like_insights_object(nested):
                return nested

    return parsed


def _parsed_object_to_insights(parsed: dict[str, object]) -> dict[str, list[str]]:
    return {
        "key_insights": _section_to_strings(
            _get_case_insensitive_value(parsed, "key_insights", "key insights", "insights", "summary")
        ),
        "trends": _section_to_strings(_get_case_insensitive_value(parsed, "trends", "trend")),
        "data_quality_notes": _section_to_strings(
            _get_case_insensitive_value(parsed, "data_quality_notes", "data quality notes", "data_quality")
        ),
        "simple_recommendations": _section_to_strings(
            _get_case_insensitive_value(
                parsed,
                "simple_recommendations",
                "simple recommendations",
                "recommendations",
            )
        ),
    }


def _normalize_gemini_insights(text: str) -> dict[str, list[str]]:
    cleaned = _strip_json_fence(text)
    parsed = _parse_jsonish_text(cleaned)

    if isinstance(parsed, str):
        nested_parsed = _parse_jsonish_text(parsed)
        parsed = nested_parsed if nested_parsed else {"key_insights": [parsed]}

    if not isinstance(parsed, dict):
        parsed = {}

    parsed = _unwrap_nested_insights_object(parsed)
    insights = _parsed_object_to_insights(parsed)

    if (
        len(insights["key_insights"]) == 1
        and insights["key_insights"][0].lstrip().startswith("{")
    ):
        nested = _parse_jsonish_text(insights["key_insights"][0])
        if isinstance(nested, dict):
            nested_insights = _parsed_object_to_insights(nested)
            if any(nested_insights.values()):
                insights = nested_insights

    if not any(insights.values()) and cleaned:
        insights["key_insights"] = [_clean_ai_sentence(cleaned)]

    return insights


APEX_CHART_COLORS = [
    "#0f766e",
    "#2563eb",
    "#f59e0b",
    "#dc2626",
    "#7c3aed",
    "#0891b2",
    "#16a34a",
    "#db2777",
    "#9333ea",
    "#ea580c",
    "#0284c7",
    "#65a30d",
    "#be123c",
    "#4f46e5",
    "#ca8a04",
    "#059669",
]
VALID_VISUAL_CHART_TYPES = {"bar", "line", "area", "pie", "donut", "scatter", "histogram"}
BOOLEAN_TRUE_VALUES = {"true", "yes", "y", "1", "active", "enabled", "valid"}
BOOLEAN_FALSE_VALUES = {"false", "no", "n", "0", "inactive", "disabled", "invalid"}
BOOLEAN_COLUMN_HINTS = ("is", "has", "flag", "active", "enabled", "valid", "bool")


def _build_dataframe_from_visualization_payload(payload: VisualizationDatasetPayload) -> pd.DataFrame:
    columns = [str(column) for column in payload.columns]
    if len(set(columns)) != len(columns):
        raise HTTPException(status_code=400, detail="Column names must be unique")

    if not columns:
        columns = list(
            dict.fromkeys(
                str(key)
                for row in payload.rows
                for key in row.keys()
            )
        )

    rows = [
        {column: _normalize_nullable_value(row.get(column)) for column in columns}
        for row in payload.rows
    ]

    return pd.DataFrame(rows, columns=columns)


def _filter_value_is_present(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and value.strip() == "":
        return False
    return True


def _apply_visualization_filters(
    df: pd.DataFrame,
    filters: list[VisualizationFilterPayload],
) -> pd.DataFrame:
    if not filters or df.empty:
        return df.copy()

    filtered_df = df.copy()

    for filter_item in filters:
        column = str(filter_item.column)
        if column not in filtered_df.columns:
            continue

        filter_type = str(filter_item.type or "").lower().strip()
        series = filtered_df[column]

        if filter_type == "datetime" or _looks_like_datetime_for_visualization(column, series):
            parsed_series = _coerce_datetime_for_visualization(series)
            mask = pd.Series(True, index=filtered_df.index)

            if _filter_value_is_present(filter_item.start):
                start_date = pd.to_datetime(filter_item.start, errors="coerce")
                if pd.notna(start_date):
                    mask = mask & (parsed_series >= start_date)

            if _filter_value_is_present(filter_item.end):
                end_date = pd.to_datetime(filter_item.end, errors="coerce")
                if pd.notna(end_date):
                    mask = mask & (parsed_series <= end_date)

            filtered_df = filtered_df.loc[mask.fillna(False)].copy()
            continue

        if filter_type == "numeric" or pd.api.types.is_numeric_dtype(series):
            numeric_series = _coerce_numeric_for_visualization(series)
            mask = pd.Series(True, index=filtered_df.index)

            if _filter_value_is_present(filter_item.min):
                min_value = pd.to_numeric(pd.Series([filter_item.min]), errors="coerce").iloc[0]
                if pd.notna(min_value):
                    mask = mask & (numeric_series >= min_value)

            if _filter_value_is_present(filter_item.max):
                max_value = pd.to_numeric(pd.Series([filter_item.max]), errors="coerce").iloc[0]
                if pd.notna(max_value):
                    mask = mask & (numeric_series <= max_value)

            filtered_df = filtered_df.loc[mask.fillna(False)].copy()
            continue

        selected_values = [
            _format_chart_label(value)
            for value in filter_item.values
            if _filter_value_is_present(value)
        ]
        if selected_values:
            selected_lookup = {str(value) for value in selected_values}
            labels = series.map(_format_chart_label)
            filtered_df = filtered_df.loc[labels.isin(selected_lookup)].copy()

    return filtered_df


def _build_filter_metadata(
    df: pd.DataFrame,
    column_profiles: list[dict[str, object]],
    visual_df: pd.DataFrame,
) -> list[dict[str, object]]:
    filters: list[dict[str, object]] = []

    for profile in column_profiles:
        column = str(profile["name"])
        inferred_type = str(profile["type"])
        if column not in df.columns:
            continue

        if inferred_type == "datetime":
            values = _coerce_datetime_for_visualization(visual_df[column]).dropna()
            filters.append(
                {
                    "column": column,
                    "type": "datetime",
                    "start": values.min().date().isoformat() if not values.empty else None,
                    "end": values.max().date().isoformat() if not values.empty else None,
                }
            )
            continue

        if inferred_type == "numeric":
            values = _coerce_numeric_for_visualization(visual_df[column]).dropna()
            filters.append(
                {
                    "column": column,
                    "type": "numeric",
                    "min": _chart_number(values.min(), 3) if not values.empty else None,
                    "max": _chart_number(values.max(), 3) if not values.empty else None,
                }
            )
            continue

        if inferred_type in {"categorical", "boolean", "text"}:
            values = df[column].dropna().map(_format_chart_label)
            options = values.value_counts().head(80)
            filters.append(
                {
                    "column": column,
                    "type": "categorical",
                    "options": [
                        {"label": str(label), "count": int(count)}
                        for label, count in options.items()
                    ],
                }
            )

    return filters


def _column_has_boolean_name_hint(column_name: str) -> bool:
    normalized = _normalize_column_name(column_name)
    tokens = set(normalized.split("_"))
    return any(hint in tokens or normalized.startswith(f"{hint}_") for hint in BOOLEAN_COLUMN_HINTS)


def _coerce_numeric_for_visualization(series: pd.Series) -> pd.Series:
    if pd.api.types.is_bool_dtype(series):
        return pd.Series(np.nan, index=series.index, dtype="float64")

    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")

    sanitized = _sanitize_numeric_strings(series).str.replace("%", "", regex=False)
    return pd.to_numeric(sanitized, errors="coerce")


def _coerce_datetime_for_visualization(series: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(series):
        return series

    try:
        return pd.to_datetime(series, errors="coerce", format="mixed")
    except (TypeError, ValueError):
        return pd.to_datetime(series, errors="coerce")


def _looks_like_boolean_for_visualization(column_name: str, series: pd.Series) -> bool:
    if pd.api.types.is_bool_dtype(series):
        return True

    values = series.dropna()
    if values.empty:
        return False

    normalized_values = values.astype(str).str.strip().str.lower()
    unique_values = set(normalized_values.unique())
    boolean_words = BOOLEAN_TRUE_VALUES | BOOLEAN_FALSE_VALUES

    if unique_values and unique_values.issubset(boolean_words - {"0", "1"}):
        return len(unique_values) <= 2

    if unique_values and unique_values.issubset({"0", "1"}):
        return len(unique_values) <= 2 and _column_has_boolean_name_hint(column_name)

    return False


def _looks_like_datetime_for_visualization(column_name: str, series: pd.Series) -> bool:
    if pd.api.types.is_datetime64_any_dtype(series):
        return True

    if pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(series):
        return False

    values = series.dropna().astype(str).str.strip()
    if values.empty:
        return False

    normalized_name = _normalize_column_name(column_name)
    name_hint = any(
        keyword in normalized_name
        for keyword in ("date", "time", "day", "month", "year", "created", "updated", "timestamp")
    )
    sample = values.head(40)
    date_pattern = (
        r"(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,4})|"
        r"(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})|"
        r"(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})"
    )
    pattern_ratio = float(sample.str.contains(date_pattern, regex=True, case=False).mean())
    if not name_hint and pattern_ratio < 0.5:
        return False

    parsed = _coerce_datetime_for_visualization(series)
    parse_ratio = float(parsed.notna().sum()) / float(len(values))
    return parse_ratio >= (0.65 if name_hint else 0.75)


def _infer_visual_column_profiles(df: pd.DataFrame) -> tuple[list[dict[str, object]], pd.DataFrame]:
    visual_df = df.copy()
    profiles: list[dict[str, object]] = []
    row_count = int(df.shape[0])

    for column in df.columns:
        series = df[column]
        missing_values = int(series.isna().sum())
        non_null_values = int(series.notna().sum())
        unique_values = int(series.nunique(dropna=True))
        inferred_type = "unknown"

        if non_null_values > 0:
            numeric_series = _coerce_numeric_for_visualization(series)
            numeric_ratio = float(numeric_series.notna().sum()) / float(non_null_values)

            if _looks_like_boolean_for_visualization(str(column), series):
                inferred_type = "boolean"
            elif _looks_like_datetime_for_visualization(str(column), series):
                inferred_type = "datetime"
                visual_df[column] = _coerce_datetime_for_visualization(series)
            elif (pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)) or numeric_ratio >= 0.85:
                inferred_type = "numeric"
                visual_df[column] = numeric_series
            else:
                categorical_limit = min(60, max(12, int(max(row_count, 1) * 0.45)))
                inferred_type = "categorical" if unique_values <= categorical_limit else "text"

        profiles.append(
            {
                "name": str(column),
                "type": inferred_type,
                "dtype": str(visual_df[column].dtype),
                "missing_values": missing_values,
                "non_null_values": non_null_values,
                "unique_values": unique_values,
            }
        )

    return profiles, visual_df


def _visual_type_groups(profiles: list[dict[str, object]]) -> dict[str, list[str]]:
    return {
        "numeric": [str(profile["name"]) for profile in profiles if profile["type"] == "numeric"],
        "datetime": [str(profile["name"]) for profile in profiles if profile["type"] == "datetime"],
        "categorical": [str(profile["name"]) for profile in profiles if profile["type"] == "categorical"],
        "text": [str(profile["name"]) for profile in profiles if profile["type"] == "text"],
        "boolean": [str(profile["name"]) for profile in profiles if profile["type"] == "boolean"],
        "unknown": [str(profile["name"]) for profile in profiles if profile["type"] == "unknown"],
    }


def _profile_type_map(profiles: list[dict[str, object]]) -> dict[str, str]:
    return {str(profile["name"]): str(profile["type"]) for profile in profiles}


def _normalize_visual_aggregation(aggregation: str | None) -> str:
    normalized = str(aggregation or "count").lower().strip()
    aliases = {
        "avg": "average",
        "mean": "average",
        "median": "average",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in {"count", "sum", "average", "min", "max"} else "count"


def _aggregate_values_for_visualization(values: pd.Series, aggregation: str) -> object:
    normalized = _normalize_visual_aggregation(aggregation)
    if normalized == "sum":
        return values.sum()
    if normalized == "average":
        return values.mean()
    if normalized == "min":
        return values.min()
    if normalized == "max":
        return values.max()
    return values.count()


def _chart_number(value: object, digits: int = 3) -> float | int | None:
    rounded = _round_or_none(value, digits)
    if rounded is None:
        return None
    return int(rounded) if float(rounded).is_integer() else rounded


def _format_chart_label(value: object) -> str:
    safe_value = _json_safe(value)
    if safe_value is None:
        return "Missing"
    if isinstance(safe_value, str):
        return safe_value[:80]
    return str(safe_value)[:80]


def _build_apex_options(
    chart_id: str,
    title: str,
    subtitle: str,
    categories: list[str] | None = None,
    labels: list[str] | None = None,
    xaxis_type: str = "category",
) -> dict[str, object]:
    options: dict[str, object] = {
        "chart": {
            "id": chart_id,
            "background": "transparent",
            "foreColor": "#47564d",
            "toolbar": {"show": False},
            "zoom": {"enabled": False},
            "animations": {"enabled": True},
        },
        "theme": {"mode": "light"},
        "colors": APEX_CHART_COLORS,
        "title": {
            "text": title,
            "style": {"fontSize": "15px", "fontWeight": 800, "color": "#1d2521"},
        },
        "subtitle": {
            "text": subtitle,
            "style": {"fontSize": "12px", "color": "#718178"},
        },
        "dataLabels": {"enabled": False},
        "grid": {"borderColor": "#dfe7e1", "strokeDashArray": 4},
        "legend": {"labels": {"colors": "#47564d"}},
        "stroke": {"curve": "smooth", "width": 3},
        "tooltip": {"theme": "light"},
        "noData": {"text": "No compatible data available"},
    }

    if categories is not None:
        options["xaxis"] = {
            "type": xaxis_type,
            "categories": categories if xaxis_type == "category" else None,
            "labels": {
                "style": {"colors": "#718178"},
                "rotate": -35,
                "trim": True,
            },
        }
        options["yaxis"] = {"labels": {"style": {"colors": "#718178"}}}

    if labels is not None:
        options["labels"] = labels
        options["legend"] = {
            "position": "bottom",
            "labels": {"colors": "#47564d"},
        }

    return options


def _empty_apex_chart(
    chart_id: str,
    chart_type: str,
    title: str,
    message: str,
    x_axis: str | None = None,
    y_axis: str | None = None,
    aggregation: str = "count",
) -> dict[str, object]:
    apex_type = "bar" if chart_type == "histogram" else chart_type
    if apex_type not in {"bar", "line", "area", "pie", "donut", "scatter"}:
        apex_type = "bar"

    return {
        "id": chart_id,
        "title": title,
        "description": message,
        "type": apex_type,
        "chart_type": chart_type,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "aggregation": _normalize_visual_aggregation(aggregation),
        "series": [],
        "options": _build_apex_options(chart_id, title, message),
        "empty": True,
    }


def _dimension_pairs(
    df: pd.DataFrame,
    x_axis: str,
    y_axis: str | None,
    aggregation: str,
    limit: int = 14,
) -> list[tuple[str, object]]:
    normalized_aggregation = _normalize_visual_aggregation(aggregation)
    labels = df[x_axis].map(_format_chart_label)

    if normalized_aggregation == "count" or not y_axis or y_axis not in df.columns:
        counts = labels.value_counts(dropna=False).head(limit)
        return [(str(label), int(value)) for label, value in counts.items()]

    numeric_values = _coerce_numeric_for_visualization(df[y_axis])
    working = pd.DataFrame({"x": labels, "y": numeric_values}).dropna(subset=["y"])
    if working.empty:
        return []

    grouped = (
        working.groupby("x")["y"]
        .agg(lambda values: _aggregate_values_for_visualization(values, normalized_aggregation))
        .sort_values(ascending=False)
        .head(limit)
    )
    return [(str(label), value) for label, value in grouped.items()]


def _build_dimension_apex_chart(
    df: pd.DataFrame,
    chart_id: str,
    chart_type: str,
    x_axis: str,
    y_axis: str | None,
    aggregation: str,
    title: str,
    description: str,
) -> dict[str, object]:
    pairs = _dimension_pairs(df, x_axis, y_axis, aggregation)
    if not pairs:
        return _empty_apex_chart(chart_id, chart_type, title, description, x_axis, y_axis, aggregation)

    labels = [label for label, _ in pairs]
    values = [_chart_number(value, 2) for _, value in pairs]
    values = [value for value in values if value is not None]
    normalized_aggregation = _normalize_visual_aggregation(aggregation)

    if chart_type in {"pie", "donut"}:
        options = _build_apex_options(chart_id, title, description, labels=labels)
        if chart_type == "donut":
            options["plotOptions"] = {"pie": {"donut": {"size": "62%"}}}
        series: object = values
    else:
        options = _build_apex_options(chart_id, title, description, categories=labels)
        series = [{"name": "Records" if normalized_aggregation == "count" else str(y_axis), "data": values}]

    return {
        "id": chart_id,
        "title": title,
        "description": description,
        "type": chart_type,
        "chart_type": chart_type,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "aggregation": normalized_aggregation,
        "series": series,
        "options": options,
        "empty": False,
    }


def _build_time_apex_chart(
    df: pd.DataFrame,
    chart_id: str,
    chart_type: str,
    x_axis: str,
    y_axis: str,
    aggregation: str,
    title: str,
    description: str,
) -> dict[str, object]:
    normalized_aggregation = _normalize_visual_aggregation(aggregation if aggregation != "count" else "average")
    x_values = _coerce_datetime_for_visualization(df[x_axis])
    y_values = _coerce_numeric_for_visualization(df[y_axis])
    working = pd.DataFrame({"x": x_values, "y": y_values}).dropna()
    if working.empty:
        return _empty_apex_chart(chart_id, chart_type, title, description, x_axis, y_axis, aggregation)

    working["bucket"] = working["x"].dt.floor("D")
    grouped = (
        working.groupby("bucket")["y"]
        .agg(lambda values: _aggregate_values_for_visualization(values, normalized_aggregation))
        .sort_index()
        .tail(60)
    )
    data = [
        {"x": date_value.isoformat(), "y": _chart_number(value, 2)}
        for date_value, value in grouped.items()
    ]

    options = _build_apex_options(chart_id, title, description, categories=[], xaxis_type="datetime")
    options["xaxis"] = {
        "type": "datetime",
        "labels": {"style": {"colors": "#718178"}},
    }

    return {
        "id": chart_id,
        "title": title,
        "description": description,
        "type": "area" if chart_type == "area" else "line",
        "chart_type": chart_type,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "aggregation": normalized_aggregation,
        "series": [{"name": y_axis, "data": data}],
        "options": options,
        "empty": False,
    }


def _build_sequence_line_chart(
    df: pd.DataFrame,
    chart_id: str,
    chart_type: str,
    y_axis: str,
    title: str,
    description: str,
) -> dict[str, object]:
    values = _coerce_numeric_for_visualization(df[y_axis]).dropna().head(60).reset_index(drop=True)
    if values.empty:
        return _empty_apex_chart(chart_id, chart_type, title, description, None, y_axis, "average")

    data = [{"x": int(index + 1), "y": _chart_number(value, 2)} for index, value in values.items()]
    options = _build_apex_options(chart_id, title, description, categories=[])
    options["xaxis"] = {
        "type": "numeric",
        "title": {"text": "Row index", "style": {"color": "#718178"}},
        "labels": {"style": {"colors": "#718178"}},
    }

    return {
        "id": chart_id,
        "title": title,
        "description": description,
        "type": "area" if chart_type == "area" else "line",
        "chart_type": chart_type,
        "x_axis": None,
        "y_axis": y_axis,
        "aggregation": "average",
        "series": [{"name": y_axis, "data": data}],
        "options": options,
        "empty": False,
    }


def _build_scatter_apex_chart(
    df: pd.DataFrame,
    chart_id: str,
    x_axis: str,
    y_axis: str,
    title: str,
    description: str,
) -> dict[str, object]:
    x_values = _coerce_numeric_for_visualization(df[x_axis])
    y_values = _coerce_numeric_for_visualization(df[y_axis])
    working = pd.DataFrame({"x": x_values, "y": y_values}).dropna().head(250)
    if working.empty:
        return _empty_apex_chart(chart_id, "scatter", title, description, x_axis, y_axis)

    data = [
        {"x": _chart_number(row.x, 3), "y": _chart_number(row.y, 3)}
        for row in working.itertuples(index=False)
    ]
    options = _build_apex_options(chart_id, title, description, categories=[])
    options["xaxis"] = {
        "type": "numeric",
        "title": {"text": x_axis, "style": {"color": "#718178"}},
        "labels": {"style": {"colors": "#718178"}},
    }
    options["markers"] = {"size": 5, "strokeWidth": 0}

    return {
        "id": chart_id,
        "title": title,
        "description": description,
        "type": "scatter",
        "chart_type": "scatter",
        "x_axis": x_axis,
        "y_axis": y_axis,
        "aggregation": "none",
        "series": [{"name": f"{y_axis} vs {x_axis}", "data": data}],
        "options": options,
        "empty": False,
    }


def _build_histogram_apex_chart(
    df: pd.DataFrame,
    chart_id: str,
    numeric_column: str,
    title: str,
    description: str,
) -> dict[str, object]:
    values = _coerce_numeric_for_visualization(df[numeric_column]).dropna()
    if values.empty:
        return _empty_apex_chart(chart_id, "histogram", title, description, numeric_column, None)

    unique_values = int(values.nunique())
    if unique_values <= 1:
        labels = [_format_chart_label(values.iloc[0])]
        counts = [int(values.shape[0])]
    else:
        bin_count = min(12, max(5, int(np.sqrt(max(len(values), 1)))))
        buckets = pd.cut(values, bins=bin_count, include_lowest=True, duplicates="drop")
        distribution = buckets.value_counts(sort=False)
        labels = [str(interval) for interval in distribution.index]
        counts = [int(count) for count in distribution.values]

    return {
        "id": chart_id,
        "title": title,
        "description": description,
        "type": "bar",
        "chart_type": "histogram",
        "x_axis": numeric_column,
        "y_axis": None,
        "aggregation": "count",
        "series": [{"name": "Records", "data": counts}],
        "options": _build_apex_options(chart_id, title, description, categories=labels),
        "empty": False,
    }


def _build_custom_apex_chart(
    df: pd.DataFrame,
    profiles: list[dict[str, object]],
    chart_type: str | None,
    x_axis: str | None,
    y_axis: str | None,
    aggregation: str | None,
    chart_id: str = "custom-chart",
) -> dict[str, object]:
    normalized_chart_type = str(chart_type or "bar").lower().strip()
    normalized_aggregation = _normalize_visual_aggregation(aggregation)
    profile_types = _profile_type_map(profiles)

    if normalized_chart_type not in VALID_VISUAL_CHART_TYPES:
        return _empty_apex_chart(
            chart_id,
            normalized_chart_type,
            "Unsupported Chart",
            "Choose bar, line, area, pie, donut, scatter, or histogram.",
            x_axis,
            y_axis,
            normalized_aggregation,
        )

    if normalized_chart_type == "histogram":
        numeric_column = y_axis if y_axis in df.columns and profile_types.get(str(y_axis)) == "numeric" else x_axis
        if not numeric_column or numeric_column not in df.columns or profile_types.get(str(numeric_column)) != "numeric":
            return _empty_apex_chart(chart_id, "histogram", "Histogram", "Select a numeric column.", x_axis, y_axis)
        return _build_histogram_apex_chart(
            df,
            chart_id,
            str(numeric_column),
            f"Distribution of {numeric_column}",
            f"Histogram for {numeric_column}.",
        )

    if normalized_chart_type == "scatter":
        if not x_axis or not y_axis or x_axis not in df.columns or y_axis not in df.columns:
            return _empty_apex_chart(chart_id, "scatter", "Scatter Chart", "Select two numeric columns.", x_axis, y_axis)
        if profile_types.get(str(x_axis)) != "numeric" or profile_types.get(str(y_axis)) != "numeric":
            return _empty_apex_chart(chart_id, "scatter", "Scatter Chart", "Scatter charts require two numeric columns.", x_axis, y_axis)
        return _build_scatter_apex_chart(
            df,
            chart_id,
            str(x_axis),
            str(y_axis),
            f"{y_axis} vs {x_axis}",
            "Two numeric columns plotted against each other.",
        )

    if normalized_chart_type in {"line", "area"}:
        if y_axis and y_axis in df.columns and profile_types.get(str(y_axis)) == "numeric":
            if x_axis and x_axis in df.columns and profile_types.get(str(x_axis)) == "datetime":
                return _build_time_apex_chart(
                    df,
                    chart_id,
                    normalized_chart_type,
                    str(x_axis),
                    str(y_axis),
                    normalized_aggregation,
                    f"{y_axis} over {x_axis}",
                    f"{normalized_aggregation.title()} of {y_axis} grouped by {x_axis}.",
                )
            if x_axis and x_axis in df.columns:
                return _build_dimension_apex_chart(
                    df,
                    chart_id,
                    "line",
                    str(x_axis),
                    str(y_axis),
                    normalized_aggregation,
                    f"{y_axis} by {x_axis}",
                    f"{normalized_aggregation.title()} of {y_axis} grouped by {x_axis}.",
                )
            return _build_sequence_line_chart(
                df,
                chart_id,
                normalized_chart_type,
                str(y_axis),
                f"{y_axis} by row order",
                "Sequential numeric values across row order.",
            )

        return _empty_apex_chart(chart_id, normalized_chart_type, "Line Chart", "Select a numeric Y-axis column.", x_axis, y_axis)

    if not x_axis or x_axis not in df.columns:
        return _empty_apex_chart(chart_id, normalized_chart_type, "Category Chart", "Select an X-axis column.", x_axis, y_axis, normalized_aggregation)

    title_measure = "records" if normalized_aggregation == "count" or not y_axis else str(y_axis)
    return _build_dimension_apex_chart(
        df,
        chart_id,
        normalized_chart_type,
        str(x_axis),
        str(y_axis) if y_axis else None,
        normalized_aggregation,
        f"{title_measure.title()} by {x_axis}",
        f"{normalized_aggregation.title()} grouped by {x_axis}.",
    )


def _build_legacy_points_from_chart(chart: dict[str, object]) -> list[dict[str, object]]:
    series = chart.get("series")
    if not isinstance(series, list) or not series:
        return []

    first_series = series[0]
    if not isinstance(first_series, dict):
        return []

    data = first_series.get("data")
    if not isinstance(data, list):
        return []

    points: list[dict[str, object]] = []
    for index, item in enumerate(data):
        if isinstance(item, dict):
            label = item.get("x", index + 1)
            value = item.get("y")
        else:
            label = index + 1
            value = item

        chart_value = _chart_number(value, 2)
        if chart_value is not None:
            points.append({"label": _format_chart_label(label), "value": chart_value})

    return points


def _duplicate_row_count(df: pd.DataFrame) -> int:
    try:
        return int(df.duplicated().sum())
    except TypeError:
        normalized = df.apply(
            lambda row: json.dumps([_json_safe(value) for value in row.tolist()], sort_keys=True),
            axis=1,
        )
        return int(normalized.duplicated().sum())


def _build_top_category(df: pd.DataFrame, category_candidates: list[str]) -> dict[str, object] | None:
    best_category: dict[str, object] | None = None

    for column in category_candidates:
        values = df[column].dropna().map(_format_chart_label)
        if values.empty:
            continue

        counts = values.value_counts().head(8)
        if counts.empty:
            continue

        top_label, top_count = next(iter(counts.items()))
        candidate = {
            "column": column,
            "label": str(top_label),
            "count": int(top_count),
            "data": [{"label": str(label), "value": int(value)} for label, value in counts.items()],
        }

        if best_category is None or int(candidate["count"]) > int(best_category["count"]):
            best_category = candidate

    return best_category


def _semantic_measure_score(column_name: str) -> int:
    normalized = _normalize_column_name(column_name)
    score = 0
    weighted_keywords = {
        "revenue": 9,
        "sales": 9,
        "sale": 9,
        "amount": 8,
        "total": 8,
        "profit": 8,
        "price": 7,
        "value": 7,
        "cost": 6,
        "quantity": 5,
        "qty": 5,
        "score": 4,
        "rating": 4,
        "count": 3,
    }

    for keyword, weight in weighted_keywords.items():
        if keyword in normalized:
            score += weight

    if any(token in normalized for token in ("id", "zip", "postal", "phone", "code")):
        score -= 12

    return score


def _semantic_category_score(column_name: str) -> int:
    normalized = _normalize_column_name(column_name)
    score = 0
    weighted_keywords = {
        "category": 9,
        "product": 9,
        "customer": 8,
        "client": 8,
        "region": 8,
        "market": 7,
        "segment": 7,
        "department": 6,
        "city": 6,
        "country": 6,
        "state": 5,
        "type": 5,
        "status": 4,
        "name": 4,
    }

    for keyword, weight in weighted_keywords.items():
        if keyword in normalized:
            score += weight

    if any(token in normalized for token in ("id", "email", "phone", "address", "url")):
        score -= 10

    return score


def _rank_numeric_columns(df: pd.DataFrame, numeric_columns: list[str]) -> list[str]:
    def _score(column: str) -> tuple[int, int, int, str]:
        series = _coerce_numeric_for_visualization(df[column])
        non_null = int(series.notna().sum())
        unique_values = int(series.nunique(dropna=True))
        return (_semantic_measure_score(column), non_null, unique_values, column)

    return sorted(numeric_columns, key=_score, reverse=True)


def _rank_category_columns(df: pd.DataFrame, category_columns: list[str]) -> list[str]:
    def _score(column: str) -> tuple[int, int, int, str]:
        series = df[column].dropna().map(_format_chart_label)
        unique_values = int(series.nunique(dropna=True))
        non_null = int(series.shape[0])
        balance_score = -abs(unique_values - min(max(non_null // 4, 2), 24))
        return (_semantic_category_score(column), balance_score, non_null, column)

    return sorted(category_columns, key=_score, reverse=True)


def _format_kpi_number(value: object) -> str:
    number = _chart_number(value, 2)
    if number is None:
        return "N/A"
    return f"{number:,}" if isinstance(number, int) else f"{number:,.2f}".rstrip("0").rstrip(".")


def _format_kpi_date(value: object) -> str:
    if value is None or pd.isna(value):  # type: ignore[arg-type]
        return "N/A"

    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()

    return str(value)


def _build_category_measure_insight(
    df: pd.DataFrame,
    category_column: str,
    numeric_column: str,
    aggregation: str = "sum",
) -> dict[str, object] | None:
    working = pd.DataFrame(
        {
            "category": df[category_column].map(_format_chart_label),
            "measure": _coerce_numeric_for_visualization(df[numeric_column]),
        }
    ).dropna(subset=["measure"])
    if working.empty:
        return None

    grouped = working.groupby("category")["measure"].agg(
        lambda values: _aggregate_values_for_visualization(values, aggregation)
    )
    grouped = grouped.dropna()
    if grouped.empty:
        return None

    top_label = str(grouped.idxmax())
    top_value = grouped.loc[top_label]
    return {
        "label": f"Top {category_column}",
        "value": top_label,
        "hint": f"{_format_kpi_number(top_value)} {numeric_column} ({aggregation})",
        "type": "category_measure",
        "priority": 96,
    }


def _build_trend_kpi(df: pd.DataFrame, datetime_column: str, numeric_column: str) -> dict[str, object] | None:
    working = pd.DataFrame(
        {
            "date": _coerce_datetime_for_visualization(df[datetime_column]),
            "measure": _coerce_numeric_for_visualization(df[numeric_column]),
        }
    ).dropna()
    if working.empty:
        return None

    working["bucket"] = working["date"].dt.floor("D")
    grouped = working.groupby("bucket")["measure"].sum().sort_index()
    grouped = grouped[grouped.notna()]
    if len(grouped) < 2:
        return None

    first_value = float(grouped.iloc[0])
    last_value = float(grouped.iloc[-1])
    if first_value == 0:
        delta_label = "New activity"
    else:
        delta = ((last_value - first_value) / abs(first_value)) * 100
        delta_label = f"{delta:+.1f}%"

    direction = "up" if last_value > first_value else "down" if last_value < first_value else "flat"
    return {
        "label": f"{numeric_column} Trend",
        "value": delta_label,
        "hint": f"{direction.title()} from {_format_kpi_date(grouped.index[0])} to {_format_kpi_date(grouped.index[-1])}",
        "type": "trend",
        "priority": 82,
    }


def _build_insight_kpis(
    df: pd.DataFrame,
    numeric_columns: list[str],
    category_candidates: list[str],
    datetime_columns: list[str],
    top_category: dict[str, object] | None,
) -> list[dict[str, object]]:
    kpis: list[dict[str, object]] = []
    ranked_numeric = _rank_numeric_columns(df, numeric_columns)
    ranked_categories = _rank_category_columns(df, category_candidates)

    if ranked_categories and ranked_numeric:
        top_category_measure = _build_category_measure_insight(df, ranked_categories[0], ranked_numeric[0], "sum")
        if top_category_measure:
            kpis.append(top_category_measure)

    if ranked_numeric:
        primary_numeric = ranked_numeric[0]
        series = _coerce_numeric_for_visualization(df[primary_numeric]).dropna()
        if not series.empty:
            kpis.extend(
                [
                    {
                        "label": f"Total {primary_numeric}",
                        "value": _format_kpi_number(series.sum()),
                        "hint": f"Across {int(series.count()):,} valid records",
                        "type": "total",
                        "priority": 92,
                    },
                    {
                        "label": f"Average {primary_numeric}",
                        "value": _format_kpi_number(series.mean()),
                        "hint": f"Typical value for {primary_numeric}",
                        "type": "average",
                        "priority": 80,
                    },
                    {
                        "label": f"Highest {primary_numeric}",
                        "value": _format_kpi_number(series.max()),
                        "hint": "Maximum observed value",
                        "type": "maximum",
                        "priority": 76,
                    },
                    {
                        "label": f"Lowest {primary_numeric}",
                        "value": _format_kpi_number(series.min()),
                        "hint": "Minimum observed value",
                        "type": "minimum",
                        "priority": 58,
                    },
                ]
            )

    if top_category:
        kpis.append(
            {
                "label": f"Most Frequent {top_category['column']}",
                "value": top_category["label"],
                "hint": f"{int(top_category['count']):,} records",
                "type": "mode",
                "priority": 86,
            }
        )

    if ranked_categories:
        category_column = ranked_categories[0]
        values = df[category_column].dropna().map(_format_chart_label)
        if not values.empty:
            kpis.append(
                {
                    "label": f"Unique {category_column}",
                    "value": f"{int(values.nunique()):,}",
                    "hint": "Distinct categories detected",
                    "type": "unique_categories",
                    "priority": 50,
                }
            )

    if datetime_columns:
        primary_date = datetime_columns[0]
        date_values = _coerce_datetime_for_visualization(df[primary_date]).dropna()
        if not date_values.empty:
            kpis.append(
                {
                    "label": f"Latest {primary_date}",
                    "value": _format_kpi_date(date_values.max()),
                    "hint": "Most recent record date",
                    "type": "latest_date",
                    "priority": 84,
                }
            )

    if datetime_columns and ranked_numeric:
        trend_kpi = _build_trend_kpi(df, datetime_columns[0], ranked_numeric[0])
        if trend_kpi:
            kpis.append(trend_kpi)

    kpis.append(
        {
            "label": "Total Records",
            "value": f"{int(df.shape[0]):,}",
            "hint": "Rows in the cleaned dataset",
            "type": "records",
            "priority": 20,
        }
    )

    deduped: dict[tuple[str, str], dict[str, object]] = {}
    for kpi in kpis:
        key = (str(kpi["label"]), str(kpi["value"]))
        existing = deduped.get(key)
        if existing is None or int(kpi["priority"]) > int(existing["priority"]):
            deduped[key] = kpi

    return [
        {key: value for key, value in kpi.items() if key != "priority"}
        for kpi in sorted(deduped.values(), key=lambda item: int(item["priority"]), reverse=True)[:8]
    ]


def _build_visualization_payload(
    df: pd.DataFrame,
    override: VisualizationOverridePayload | None = None,
) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    df = df.replace([np.inf, -np.inf], np.nan)
    column_profiles, visual_df = _infer_visual_column_profiles(df)
    type_groups = _visual_type_groups(column_profiles)
    filter_metadata = _build_filter_metadata(df, column_profiles, visual_df)
    numeric_columns = type_groups["numeric"]
    datetime_columns = type_groups["datetime"]
    category_candidates = [
        *type_groups["categorical"],
        *type_groups["boolean"],
        *type_groups["text"],
    ]
    warnings: list[str] = []

    missing_values = [
        {"label": str(column), "value": int(df[column].isna().sum())} for column in df.columns
    ]
    top_category = _build_top_category(visual_df, category_candidates)
    top_categories = (
        {
            "column": top_category["column"],
            "data": top_category["data"],
        }
        if top_category
        else None
    )
    averages = [
        {"column": column, "average": _round_or_none(_coerce_numeric_for_visualization(visual_df[column]).mean(), 2)}
        for column in numeric_columns[:6]
    ]
    ranked_numeric_columns = _rank_numeric_columns(visual_df, numeric_columns)
    ranked_category_columns = _rank_category_columns(visual_df, category_candidates)
    insight_kpis = _build_insight_kpis(
        visual_df,
        numeric_columns=numeric_columns,
        category_candidates=category_candidates,
        datetime_columns=datetime_columns,
        top_category=top_category,
    )

    chart_configs: list[dict[str, object]] = []

    if datetime_columns and ranked_numeric_columns:
        chart_configs.append(
            _build_time_apex_chart(
                visual_df,
                "auto-date-line",
                "line",
                datetime_columns[0],
                ranked_numeric_columns[0],
                "average",
                f"{ranked_numeric_columns[0]} over {datetime_columns[0]}",
                "Date plus numeric column detected.",
            )
        )

    if ranked_category_columns and ranked_numeric_columns:
        chart_configs.append(
            _build_dimension_apex_chart(
                visual_df,
                "auto-category-measure-bar",
                "bar",
                ranked_category_columns[0],
                ranked_numeric_columns[0],
                "sum",
                f"{ranked_numeric_columns[0]} by {ranked_category_columns[0]}",
                "Top categories by numeric performance.",
            )
        )

    if ranked_category_columns:
        chart_configs.append(
            _build_dimension_apex_chart(
                visual_df,
                "auto-category-bar",
                "bar",
                ranked_category_columns[0],
                None,
                "count",
                f"Records by {ranked_category_columns[0]}",
                "Categorical/text distribution detected.",
            )
        )
        chart_configs.append(
            _build_dimension_apex_chart(
                visual_df,
                "auto-category-donut",
                "donut",
                ranked_category_columns[1] if len(ranked_category_columns) > 1 else ranked_category_columns[0],
                None,
                "count",
                "Category Share",
                "Donut chart for category distribution.",
            )
        )

    if len(ranked_numeric_columns) >= 2:
        chart_configs.append(
            _build_scatter_apex_chart(
                visual_df,
                "auto-numeric-scatter",
                ranked_numeric_columns[0],
                ranked_numeric_columns[1],
                f"{ranked_numeric_columns[1]} vs {ranked_numeric_columns[0]}",
                "Two numeric columns detected.",
            )
        )

    if ranked_numeric_columns:
        chart_configs.append(
            _build_histogram_apex_chart(
                visual_df,
                "auto-numeric-histogram",
                ranked_numeric_columns[0],
                f"Distribution of {ranked_numeric_columns[0]}",
                "Numeric column distribution detected.",
            )
        )

    if not chart_configs:
        warnings.append("No chart-ready column combinations were found.")

    custom_chart = None
    if override is not None:
        custom_chart = _build_custom_apex_chart(
            visual_df,
            column_profiles,
            chart_type=override.chart_type,
            x_axis=override.x_axis,
            y_axis=override.y_axis,
            aggregation=override.aggregation,
            chart_id="custom-chart",
        )

    trend_chart = next(
        (chart for chart in chart_configs if chart.get("chart_type") in {"line", "area"} and not chart.get("empty")),
        None,
    )
    trend_line = (
        {
            "x_label": trend_chart.get("x_axis") or "Row Index",
            "y_label": trend_chart.get("y_axis"),
            "data": _build_legacy_points_from_chart(trend_chart),
        }
        if trend_chart
        else None
    )
    if trend_line is None and ranked_numeric_columns:
        sequence_chart = _build_sequence_line_chart(
            visual_df,
            "legacy-sequence-line",
            "line",
            ranked_numeric_columns[0],
            f"{ranked_numeric_columns[0]} by row order",
            "Sequential numeric values across row order.",
        )
        trend_line = {
            "x_label": "Row Index",
            "y_label": ranked_numeric_columns[0],
            "data": _build_legacy_points_from_chart(sequence_chart),
        }

    histogram_chart = next(
        (chart for chart in chart_configs if chart.get("chart_type") == "histogram" and not chart.get("empty")),
        None,
    )
    numeric_distribution = (
        {
            "column": histogram_chart.get("x_axis"),
            "data": [
                {"label": label, "value": value}
                for label, value in zip(
                    ((histogram_chart.get("options") or {}).get("xaxis") or {}).get("categories") or [],
                    ((histogram_chart.get("series") or [{}])[0].get("data") if histogram_chart.get("series") else []) or [],
                )
            ],
        }
        if histogram_chart
        else None
    )

    full_df = df.where(pd.notna(df), None)
    table_rows = _json_safe(full_df.to_dict(orient="records"))
    summary = {
        "total_rows": int(df.shape[0]),
        "total_columns": int(df.shape[1]),
        "missing_values": int(df.isna().sum().sum()) if df.shape[1] else 0,
        "duplicate_rows": _duplicate_row_count(df) if not df.empty else 0,
        "top_category": (
            {
                "column": top_category["column"],
                "label": top_category["label"],
                "count": top_category["count"],
            }
            if top_category
            else None
        ),
        "averages": averages,
    }

    return {
        "summary": summary,
        "kpis": insight_kpis,
        "insight_kpis": insight_kpis,
        "columns": column_profiles,
        "column_types": type_groups,
        "filters": filter_metadata,
        "chart_configs": chart_configs,
        "charts": chart_configs,
        "custom_chart": custom_chart,
        "table": {
            "columns": list(df.columns),
            "rows": table_rows,
            "total_rows": int(df.shape[0]),
        },
        "warnings": warnings,
        "missing_values": missing_values,
        "top_categories": top_categories,
        "numeric_distribution": numeric_distribution,
        "trend_line": trend_line,
    }


def _safe_compare_value(value: object) -> object:
    safe_value = _json_safe(value)
    if isinstance(safe_value, float):
        return round(safe_value, 8)
    return safe_value


def _values_match(left: object, right: object) -> bool:
    return _safe_compare_value(left) == _safe_compare_value(right)


def _row_to_safe_dict(df: pd.DataFrame, row_label: object, columns: list[str]) -> dict[str, object]:
    if row_label not in df.index:
        return {}

    row = df.loc[row_label]
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0]

    return {column: _json_safe(row[column]) if column in row.index else None for column in columns}


def _build_comparison(raw_df: pd.DataFrame, cleaned_df: pd.DataFrame, limit: int = 40) -> dict[str, object]:
    raw_df = _get_user_visible_dataframe(raw_df)
    cleaned_df = _get_user_visible_dataframe(cleaned_df)
    columns = list(dict.fromkeys([*list(raw_df.columns), *list(cleaned_df.columns)]))
    row_labels = list(dict.fromkeys([*list(raw_df.index), *list(cleaned_df.index)]))
    preview_limit = min(limit, len(row_labels))

    rows: list[dict[str, object]] = []
    changed_rows = 0
    changed_cells = 0

    for row_label in row_labels[:preview_limit]:
        raw_present = row_label in raw_df.index
        cleaned_present = row_label in cleaned_df.index
        raw_row = _row_to_safe_dict(raw_df, row_label, columns)
        cleaned_row = _row_to_safe_dict(cleaned_df, row_label, columns)

        changed_columns = [
            column
            for column in columns
            if not _values_match(raw_row.get(column), cleaned_row.get(column))
        ]

        if changed_columns:
            changed_rows += 1
            changed_cells += len(changed_columns)

        if raw_present and not cleaned_present:
            status = "removed"
        elif cleaned_present and not raw_present:
            status = "added"
        elif changed_columns:
            status = "changed"
        else:
            status = "unchanged"

        rows.append(
            {
                "row_number": int(row_label) + 1 if isinstance(row_label, (int, np.integer)) else str(row_label),
                "status": status,
                "raw": raw_row,
                "cleaned": cleaned_row,
                "changed_columns": changed_columns,
            }
        )

    return {
        "columns": columns,
        "rows": rows,
        "summary": {
            "raw_rows": int(raw_df.shape[0]),
            "cleaned_rows": int(cleaned_df.shape[0]),
            "raw_columns": int(raw_df.shape[1]),
            "cleaned_columns": int(cleaned_df.shape[1]),
            "preview_rows": preview_limit,
            "preview_changed_rows": changed_rows,
            "preview_changed_cells": changed_cells,
            "rows_removed": max(int(raw_df.shape[0]) - int(cleaned_df.shape[0]), 0),
        },
    }


def _get_chart_options(df: pd.DataFrame) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    numeric_columns = list(df.select_dtypes(include=["number"]).columns)
    datetime_columns = list(df.select_dtypes(include=["datetime", "datetimetz"]).columns)
    categorical_columns = list(
        df.select_dtypes(exclude=["number", "datetime", "datetimetz"]).columns
    )

    return {
        "columns": list(df.columns),
        "numeric_columns": numeric_columns,
        "categorical_columns": categorical_columns,
        "datetime_columns": datetime_columns,
    }


def _resolve_dimension(df: pd.DataFrame, dimension: str | None) -> str | None:
    if dimension and dimension in df.columns:
        return dimension

    options = _get_chart_options(df)
    for group in ("categorical_columns", "datetime_columns", "columns"):
        values = options[group]
        if isinstance(values, list) and values:
            return str(values[0])

    return None


def _resolve_measure(df: pd.DataFrame, measure: str | None) -> str | None:
    if measure and measure in df.columns and pd.api.types.is_numeric_dtype(df[measure]):
        return measure

    numeric_columns = list(df.select_dtypes(include=["number"]).columns)
    return numeric_columns[0] if numeric_columns else None


def _aggregate_series(series: pd.Series, aggregation: str) -> object:
    normalized = aggregation.lower().strip()
    if normalized == "sum":
        return series.sum()
    if normalized == "mean":
        return series.mean()
    if normalized == "median":
        return series.median()
    if normalized == "min":
        return series.min()
    if normalized == "max":
        return series.max()
    return series.count()


def _build_selectable_chart(
    df: pd.DataFrame,
    chart_type: str,
    dimension: str | None,
    measure: str | None,
    aggregation: str,
) -> dict[str, object]:
    df = _get_user_visible_dataframe(df)
    normalized_chart_type = chart_type.lower().strip()
    if normalized_chart_type not in {"bar", "line", "pie"}:
        raise HTTPException(status_code=400, detail="Invalid chart_type. Use bar, line, or pie")

    normalized_aggregation = aggregation.lower().strip()
    if normalized_aggregation not in {"count", "sum", "mean", "median", "min", "max"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid aggregation. Use count, sum, mean, median, min, or max",
        )

    resolved_dimension = _resolve_dimension(df, dimension)
    resolved_measure = _resolve_measure(df, measure)

    if resolved_dimension is None:
        return {
            "chart_type": normalized_chart_type,
            "dimension": None,
            "measure": None,
            "aggregation": normalized_aggregation,
            "data": [],
            "interpretation": "No columns are available for visualization.",
            "options": _get_chart_options(df),
        }

    if normalized_aggregation != "count" and resolved_measure is None:
        normalized_aggregation = "count"

    if normalized_chart_type == "line" and resolved_measure is not None:
        if resolved_dimension and resolved_dimension in df.columns:
            working = df[[resolved_dimension, resolved_measure]].copy()
            working = working.dropna(subset=[resolved_dimension, resolved_measure])
            if pd.api.types.is_datetime64_any_dtype(working[resolved_dimension]):
                grouped = working.groupby(working[resolved_dimension].dt.date)[resolved_measure].agg(
                    lambda values: _aggregate_series(values, normalized_aggregation)
                )
            else:
                grouped = working.groupby(resolved_dimension)[resolved_measure].agg(
                    lambda values: _aggregate_series(values, normalized_aggregation)
                )
            grouped = grouped.sort_index().head(40)
        else:
            values = df[resolved_measure].dropna().head(40)
            grouped = pd.Series(values.values, index=range(1, len(values) + 1))
    elif normalized_aggregation == "count" or resolved_measure is None:
        labels = df[resolved_dimension].fillna("Missing").astype(str)
        grouped = labels.value_counts().head(12)
    else:
        working = df[[resolved_dimension, resolved_measure]].copy()
        working[resolved_dimension] = working[resolved_dimension].fillna("Missing").astype(str)
        working[resolved_measure] = pd.to_numeric(working[resolved_measure], errors="coerce")
        working = working.dropna(subset=[resolved_measure])
        grouped = (
            working.groupby(resolved_dimension)[resolved_measure]
            .agg(lambda values: _aggregate_series(values, normalized_aggregation))
            .sort_values(ascending=False)
            .head(12)
        )

    data = [
        {"label": str(label), "value": _round_or_none(value, 2)}
        for label, value in grouped.items()
        if _round_or_none(value, 2) is not None
    ]

    metric_label = "records" if normalized_aggregation == "count" or not resolved_measure else resolved_measure
    interpretation = (
        f"{normalized_chart_type.title()} chart grouped by {resolved_dimension} "
        f"using {normalized_aggregation} of {metric_label}."
    )

    return {
        "chart_type": normalized_chart_type,
        "dimension": resolved_dimension,
        "measure": resolved_measure,
        "aggregation": normalized_aggregation,
        "x_label": resolved_dimension,
        "y_label": metric_label,
        "data": data,
        "interpretation": interpretation,
        "options": _get_chart_options(df),
    }


def _build_updated_dataframe(
    columns: list[str],
    rows: list[dict[str, object]],
    previous_df: pd.DataFrame,
) -> pd.DataFrame:
    normalized_columns = [str(column) for column in columns]
    normalized_rows: list[dict[str, object]] = []

    for row in rows:
        normalized_rows.append(
            {
                column: _normalize_nullable_value(row.get(column))
                for column in normalized_columns
            }
        )

    updated_df = pd.DataFrame(normalized_rows, columns=normalized_columns)
    critical_columns = [
        column
        for column in normalized_columns
        if _column_matches_keywords(column, tuple(DEFAULT_CLEANING_CONFIG["critical_keywords"]))  # type: ignore[arg-type]
    ]

    for column in critical_columns:
        missing_rows = updated_df.index[updated_df[column].isna()].tolist()
        if missing_rows:
            row_numbers = ", ".join(str(index + 1) for index in missing_rows[:5])
            raise HTTPException(
                status_code=400,
                detail=f"{column} is required. Missing value found on row(s): {row_numbers}",
            )

    for column in normalized_columns:
        previous_series = previous_df[column] if column in previous_df.columns else None
        updated_series = updated_df[column]
        non_null_count = int(updated_series.notna().sum())
        if non_null_count == 0:
            continue

        if _is_numeric_input_column(column, previous_series):
            parsed = pd.to_numeric(updated_series, errors="coerce")
            invalid_mask = updated_series.notna() & parsed.isna()
            if bool(invalid_mask.any()):
                row_numbers = ", ".join(str(index + 1) for index in updated_df.index[invalid_mask][:5])
                raise HTTPException(
                    status_code=400,
                    detail=f"{column} must be numeric. Invalid value found on row(s): {row_numbers}",
                )

            if _normalize_column_name(column) == "age":
                non_integer_mask = parsed.notna() & (parsed % 1 != 0)
                negative_mask = parsed.notna() & (parsed < 0)
                invalid_age_mask = non_integer_mask | negative_mask
                if bool(invalid_age_mask.any()):
                    row_numbers = ", ".join(str(index + 1) for index in updated_df.index[invalid_age_mask][:5])
                    raise HTTPException(
                        status_code=400,
                        detail=f"{column} must be a non-negative whole number. Invalid value found on row(s): {row_numbers}",
                    )
                updated_df[column] = parsed.astype("Int64")
            else:
                updated_df[column] = parsed
            continue

        if previous_series is not None and pd.api.types.is_datetime64_any_dtype(previous_series):
            parsed = pd.to_datetime(updated_series, errors="coerce")
            invalid_mask = updated_series.notna() & parsed.isna()
            if bool(invalid_mask.any()):
                row_numbers = ", ".join(str(index + 1) for index in updated_df.index[invalid_mask][:5])
                raise HTTPException(
                    status_code=400,
                    detail=f"{column} must be a valid date/time. Invalid value found on row(s): {row_numbers}",
                )
            updated_df[column] = parsed

    return updated_df


def _build_cleaning_config_from_payload(payload: CleaningConfigPayload | None) -> dict[str, object] | None:
    if payload is None:
        return None

    config = payload.model_dump(exclude_none=True)
    for keyword_field in ("critical_keywords", "required_keywords"):
        if keyword_field not in config:
            continue
        config[keyword_field] = tuple(
            str(keyword).strip()
            for keyword in config[keyword_field]
            if str(keyword).strip()
        )

    if config.get("required_missing_drop_threshold") == 0:
        config["required_missing_drop_threshold"] = None

    return config


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> dict[str, object]:
    extension = _validate_upload_file(file)

    try:
        content = await file.read()
        df = _read_tabular_file(content, extension)
    finally:
        await file.close()

    if df.shape[1] == 0:
        raise HTTPException(status_code=400, detail="Uploaded file has no columns")

    df.columns = [str(column) for column in df.columns]
    full_dataset = _build_full_dataset(df)

    dataset_id = str(uuid4())
    DATASETS[dataset_id] = {
        "filename": file.filename,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "raw": df,
        "cleaned": None,
        "cleaning_summary": None,
    }

    return {
        "dataset_id": dataset_id,
        "filename": file.filename,
        "columns": full_dataset["columns"],
        "rows": full_dataset["rows"],
        "total_rows": full_dataset["total_rows"],
        "total_columns": full_dataset["total_columns"],
        "profile": _build_profile(df, preview_limit=12),
    }


@app.get("/datasets/{dataset_id}/profile")
def get_profile(
    dataset_id: str,
    stage: str = "latest",
    preview_rows: int = Query(default=12, ge=1, le=100),
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "profile": _build_profile(df, preview_limit=preview_rows),
    }


@app.get("/datasets/{dataset_id}/table")
def get_dataset_table(
    dataset_id: str,
    stage: str = "raw",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "table": _build_table_page(df, page=page, page_size=page_size),
    }


@app.get("/datasets/{dataset_id}/export")
def export_dataset(
    dataset_id: str,
    stage: str = "cleaned",
) -> Response:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)
    export_df = _get_user_visible_dataframe(df)
    csv_content = export_df.to_csv(index=False)
    filename = _safe_export_filename(dataset.get("filename"), resolved_stage)

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/datasets/{dataset_id}/state")
def get_dataset_state(
    dataset_id: str,
    preview_rows: int = Query(default=12, ge=1, le=100),
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)

    raw_df = dataset.get("raw")
    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    cleaned_df = dataset.get("cleaned")
    has_cleaned = isinstance(cleaned_df, pd.DataFrame)
    active_df = cleaned_df if has_cleaned else raw_df

    full_dataset = _build_full_dataset(active_df)

    return {
        "dataset_id": dataset_id,
        "filename": dataset.get("filename") or "dataset",
        "uploaded_at": dataset.get("uploaded_at"),
        "stage": "cleaned" if has_cleaned else "raw",
        "columns": full_dataset["columns"],
        "rows": full_dataset["rows"],
        "total_rows": full_dataset["total_rows"],
        "total_columns": full_dataset["total_columns"],
        "approx_size_bytes": _estimate_dataframe_size_bytes(active_df),
        "raw_profile": _build_profile(raw_df, preview_limit=preview_rows),
        "cleaned_profile": _build_profile(cleaned_df, preview_limit=preview_rows)
        if has_cleaned
        else None,
        "cleaning_summary": _json_safe(dataset.get("cleaning_summary")),
    }


@app.patch("/datasets/{dataset_id}/filename")
def rename_dataset(dataset_id: str, payload: DatasetRenamePayload) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    filename = _safe_display_filename(payload.filename)
    dataset["filename"] = filename
    dataset.pop("ai_insights_cache", None)

    return {
        "dataset_id": dataset_id,
        "filename": filename,
    }


@app.put("/datasets/{dataset_id}/raw")
def update_raw_dataset(dataset_id: str, payload: DatasetUpdatePayload) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    raw_df = dataset.get("raw")
    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    if len(set(payload.columns)) != len(payload.columns):
        raise HTTPException(status_code=400, detail="Column names must be unique")

    updated_df = _build_updated_dataframe(payload.columns, payload.rows, raw_df)
    dataset["raw"] = updated_df
    dataset["cleaned"] = None
    dataset["cleaning_summary"] = None
    dataset.pop("ai_insights_cache", None)

    full_dataset = _build_full_dataset(updated_df)

    return {
        "dataset_id": dataset_id,
        "stage": "raw",
        "columns": full_dataset["columns"],
        "rows": full_dataset["rows"],
        "total_rows": full_dataset["total_rows"],
        "total_columns": full_dataset["total_columns"],
        "approx_size_bytes": _estimate_dataframe_size_bytes(updated_df),
        "profile": _build_profile(updated_df, preview_limit=20),
    }


@app.post("/datasets/{dataset_id}/clean")
def clean_dataset(dataset_id: str, payload: CleaningConfigPayload | None = None) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    raw_df = dataset["raw"]
    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    cleaned_df, summary = _clean_dataframe(raw_df, _build_cleaning_config_from_payload(payload))
    dataset["cleaned"] = cleaned_df
    dataset["cleaning_summary"] = summary
    dataset.pop("ai_insights_cache", None)

    return {
        "dataset_id": dataset_id,
        "cleaning_summary": summary,
        "profile": _build_profile(cleaned_df, preview_limit=12),
    }


@app.get("/datasets/{dataset_id}/analyze")
def analyze_dataset(dataset_id: str, stage: str = "latest") -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "analysis": _build_analysis(df),
    }


@app.post("/datasets/{dataset_id}/ai-insights")
async def generate_dataset_ai_insights(
    dataset_id: str,
    stage: str = "latest",
    refresh: bool = False,
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)
    summary = _build_gemini_dataset_summary(dataset, df, resolved_stage)
    cache_key = _build_ai_summary_cache_key(summary)
    cache = dataset.setdefault("ai_insights_cache", {})

    if not isinstance(cache, dict):
        cache = {}
        dataset["ai_insights_cache"] = cache

    if not refresh and cache_key in cache:
        cached_payload = cache[cache_key]
        if isinstance(cached_payload, dict):
            return {
                "dataset_id": dataset_id,
                "stage": resolved_stage,
                "cached": True,
                **cached_payload,
            }

    api_key = (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        raise HTTPException(
            status_code=503,
            detail="Gemini API key is not configured on the backend. Add GEMINI_API_KEY to backend/.env or set it in the server environment, then restart the server.",
        )

    model = (os.getenv("GEMINI_MODEL") or GEMINI_DEFAULT_MODEL).strip() or GEMINI_DEFAULT_MODEL
    model_candidates = _get_gemini_model_candidates(model)
    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": _build_gemini_prompt(summary)}],
            }
        ],
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 1800,
            "responseMimeType": "application/json",
            "responseSchema": GEMINI_INSIGHTS_RESPONSE_SCHEMA,
        },
    }

    last_gemini_error: GeminiAPIError | None = None
    selected_model = model
    response_payload: dict[str, object] | None = None

    for candidate_model in model_candidates:
        try:
            response_payload = await asyncio.to_thread(
                _post_gemini_generate_content,
                candidate_model,
                api_key,
                request_payload,
            )
            selected_model = candidate_model
            break
        except GeminiAPIError as exc:
            last_gemini_error = exc
            if not exc.retryable:
                break

    if response_payload is None:
        raise HTTPException(
            status_code=502,
            detail=last_gemini_error.detail if last_gemini_error else "Gemini could not generate insights right now. Try again later.",
        )

    gemini_text = _extract_gemini_text(response_payload)
    insights = _normalize_gemini_insights(gemini_text)
    if not any(insights.values()):
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an empty insight response. Try again later.",
        )

    result = {
        "source": "gemini",
        "model": selected_model,
        "summary_hash": cache_key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "insights": insights,
    }
    cache[cache_key] = result

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "cached": False,
        **result,
    }


@app.get("/datasets/{dataset_id}/visualize")
def visualize_dataset(dataset_id: str, stage: str = "latest") -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    visualization = _build_visualization_payload(df)
    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "charts": visualization,
        "visualization": visualization,
        "options": _get_chart_options(df),
    }


@app.post("/api/visualize")
def visualize_cleaned_dataset(payload: VisualizationDatasetPayload) -> dict[str, object]:
    df = _build_dataframe_from_visualization_payload(payload)
    return _build_visualization_payload(df, override=payload.override)


@app.post("/api/filter")
def filter_visualization_dataset(payload: VisualizationDatasetPayload) -> dict[str, object]:
    df = _build_dataframe_from_visualization_payload(payload)
    filtered_df = _apply_visualization_filters(df, payload.filters)
    visualization = _build_visualization_payload(filtered_df, override=payload.override)
    column_profiles = visualization.get("columns")

    custom_charts: list[dict[str, object]] = []
    if isinstance(column_profiles, list):
        for chart_override in payload.chart_overrides:
            custom_chart = _build_custom_apex_chart(
                _get_user_visible_dataframe(filtered_df),
                column_profiles,
                chart_type=chart_override.chart_type,
                x_axis=chart_override.x_axis,
                y_axis=chart_override.y_axis,
                aggregation=chart_override.aggregation,
                chart_id=chart_override.id,
            )
            custom_chart["id"] = chart_override.id
            if chart_override.source:
                custom_chart["source"] = chart_override.source
            custom_charts.append(custom_chart)

    visualization["custom_charts"] = custom_charts
    visualization["active_filters"] = _json_safe([filter_item.model_dump() for filter_item in payload.filters])
    visualization["filtered_rows"] = int(filtered_df.shape[0])
    return visualization


@app.get("/datasets/{dataset_id}/compare")
def compare_dataset(
    dataset_id: str,
    limit: int = Query(default=40, ge=1, le=200),
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    raw_df = dataset.get("raw")
    cleaned_df = dataset.get("cleaned")

    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    if not isinstance(cleaned_df, pd.DataFrame):
        raise HTTPException(status_code=400, detail="Dataset has not been cleaned yet")

    return {
        "dataset_id": dataset_id,
        "comparison": _build_comparison(raw_df, cleaned_df, limit=limit),
    }


@app.get("/datasets/{dataset_id}/chart")
def build_dataset_chart(
    dataset_id: str,
    chart_type: str = Query(default="bar"),
    stage: str = "latest",
    dimension: str | None = None,
    measure: str | None = None,
    aggregation: str = "count",
) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "chart": _build_selectable_chart(
            df,
            chart_type=chart_type,
            dimension=dimension,
            measure=measure,
            aggregation=aggregation,
        ),
    }

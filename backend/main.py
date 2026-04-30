from __future__ import annotations

import re
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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


class DatasetUpdatePayload(BaseModel):
    columns: list[str] = Field(default_factory=list, min_length=1)
    rows: list[dict[str, object]] = Field(default_factory=list)


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
            return pd.read_csv(BytesIO(content))
        return pd.read_excel(BytesIO(content))
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
    preview_df = df.head(limit).copy()
    preview_df = preview_df.where(pd.notna(preview_df), None)
    return _json_safe(preview_df.to_dict(orient="records"))  # type: ignore[return-value]


def _build_full_dataset(df: pd.DataFrame) -> dict[str, object]:
    full_df = df.copy()
    full_df = full_df.where(pd.notna(full_df), None)

    return {
        "columns": list(full_df.columns),
        "rows": _json_safe(full_df.to_dict(orient="records")),
        "total_rows": int(full_df.shape[0]),
        "total_columns": int(full_df.shape[1]),
    }


def _estimate_dataframe_size_bytes(df: pd.DataFrame) -> int:
    return int(df.memory_usage(deep=True).sum())


def _build_profile(df: pd.DataFrame, preview_limit: int = 5) -> dict[str, object]:
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
            stats = {
                "count": non_null_values,
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
    "placeholder_null_tokens": ("", " ", "-", "--", "N/A", "n/a", "NULL", "null", "None", "unknown", "Unknown"),
    "critical_keywords": ("id", "email"),
    "required_keywords": ("last_name", "lastname", "surname", "department"),
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
    for column in list(cleaned_df.select_dtypes(include=["object", "string"]).columns):
        original_series = cleaned_df[column].astype("string")
        normalized_series = original_series.str.strip().str.replace(r"\s+", " ", regex=True)
        placeholder_mask = normalized_series.fillna("").str.lower().isin(placeholder_tokens)
        normalized_series = normalized_series.mask(placeholder_mask, pd.NA)

        if _is_title_case_column(str(column)):
            normalized_series = normalized_series.str.title()

        nulls_normalized += max(int(normalized_series.isna().sum()) - int(original_series.isna().sum()), 0)
        if not original_series.equals(normalized_series):
            standardized_text_columns.append(str(column))

        cleaned_df[column] = normalized_series

    converted_columns: list[dict[str, str]] = []

    # Rule 3: convert trusted date-like columns, coercing unparseable values to null and flagging them.
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
    if isinstance(numeric_range_rules, dict):
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
    all_null_mask = cleaned_df.isna().all(axis=1)
    rows_dropped["all_null"] = int(all_null_mask.sum())
    if rows_dropped["all_null"] > 0:
        cleaned_df = cleaned_df.loc[~all_null_mask].copy()

    # Rule 4: remove fully duplicated rows only.
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
    for column in key_columns:
        duplicate_mask = cleaned_df[column].notna() & cleaned_df[column].duplicated(keep=False)
        duplicate_rows = _flag_rows(duplicate_mask, "duplicate primary key flagged", str(column))
        if duplicate_rows > 0:
            flagged_counts["duplicate_primary_key"] += duplicate_rows
            duplicate_key_columns.append(str(column))
            duplicate_key_row_indexes.update(duplicate_mask[duplicate_mask].index)

    required_columns = [column for column in cleaned_df.columns if _column_matches_keywords(str(column), required_keywords)]
    missing_required_row_indexes: set[object] = set()
    if required_columns:
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
    if critical_columns:
        critical_missing_mask = cleaned_df[critical_columns].isna().any(axis=1)
        rows_dropped["critical_missing"] = int(critical_missing_mask.sum())
        if rows_dropped["critical_missing"] > 0:
            cleaned_df = cleaned_df.loc[~critical_missing_mask].copy()

    # Rule 2: fill numeric gaps deterministically; choose median for skew/outliers, otherwise mean.
    filled_numeric_mean = 0
    filled_numeric_median = 0
    filled_numeric_columns: list[dict[str, object]] = []
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
    if bool(cleaning_config["fill_text_with_mode"]):
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

    missing_after = int(cleaned_df.isna().sum().sum())
    rows_dropped["total"] = int(rows_dropped["all_null"] + rows_dropped["critical_missing"] + rows_dropped["required_threshold"])
    total_filled = filled_numeric_mean + filled_numeric_median + filled_text_mode + filled_datetime_ffill

    audit_log = {
        "nulls_normalized": int(nulls_normalized),
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
            "policy": "mode fill enabled" if bool(cleaning_config["fill_text_with_mode"]) else "preserve nulls by default",
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
        "config": {
            "fill_text_with_mode": bool(cleaning_config["fill_text_with_mode"]),
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
        "audit_log": audit_log,
        "duplicate_primary_key_columns": duplicate_key_columns,
        "data_integrity_policy": "Unknown human-entered values are preserved as null and flagged instead of guessed.",
    }
    return cleaned_df, summary


def _build_analysis(df: pd.DataFrame) -> dict[str, object]:
    numeric_columns = list(df.select_dtypes(include=["number"]).columns)
    categorical_columns = list(
        df.select_dtypes(exclude=["number", "datetime", "datetimetz"]).columns
    )

    numeric_summary: list[dict[str, object]] = []
    for column in numeric_columns:
        series = df[column]
        numeric_summary.append(
            {
                "column": column,
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


def _build_visualization_payload(df: pd.DataFrame) -> dict[str, object]:
    missing_values = [
        {"label": column, "value": int(df[column].isna().sum())} for column in df.columns
    ]

    categorical_columns = list(
        df.select_dtypes(exclude=["number", "datetime", "datetimetz"]).columns
    )
    top_categories: dict[str, object] | None = None
    for column in categorical_columns:
        values = df[column].dropna().astype(str)
        if values.empty:
            continue

        counts = values.value_counts().head(6)
        top_categories = {
            "column": column,
            "data": [{"label": label, "value": int(value)} for label, value in counts.items()],
        }
        break

    numeric_columns = list(df.select_dtypes(include=["number"]).columns)
    numeric_distribution: dict[str, object] | None = None
    trend_line: dict[str, object] | None = None

    if numeric_columns:
        numeric_column = numeric_columns[0]
        numeric_values = df[numeric_column].dropna()

        if not numeric_values.empty:
            bin_count = min(8, max(3, int(numeric_values.nunique())))
            buckets = pd.cut(
                numeric_values,
                bins=bin_count,
                include_lowest=True,
                duplicates="drop",
            )
            distribution = buckets.value_counts(sort=False)
            numeric_distribution = {
                "column": numeric_column,
                "data": [
                    {"label": str(interval), "value": int(count)}
                    for interval, count in distribution.items()
                ],
            }

        datetime_columns = list(df.select_dtypes(include=["datetime", "datetimetz"]).columns)
        if datetime_columns:
            datetime_column = datetime_columns[0]
            trend_df = df[[datetime_column, numeric_column]].dropna().sort_values(datetime_column)
            if not trend_df.empty:
                grouped = (
                    trend_df.groupby(trend_df[datetime_column].dt.date)[numeric_column]
                    .mean()
                    .head(30)
                )
                trend_line = {
                    "x_label": datetime_column,
                    "y_label": numeric_column,
                    "data": [
                        {"label": date_value.isoformat(), "value": _round_or_none(value, 2)}
                        for date_value, value in grouped.items()
                    ],
                }
        else:
            sequence = numeric_values.head(30).reset_index(drop=True)
            trend_line = {
                "x_label": "Row Index",
                "y_label": numeric_column,
                "data": [
                    {"label": str(index + 1), "value": _round_or_none(value, 2)}
                    for index, value in sequence.items()
                ],
            }

    return {
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
                column: None if row.get(column) == "" else row.get(column)
                for column in normalized_columns
            }
        )

    updated_df = pd.DataFrame(normalized_rows, columns=normalized_columns)

    for column in normalized_columns:
        if column not in previous_df.columns:
            continue

        previous_series = previous_df[column]
        updated_series = updated_df[column]
        non_null_count = int(updated_series.notna().sum())
        if non_null_count == 0:
            continue

        if pd.api.types.is_numeric_dtype(previous_series):
            parsed = pd.to_numeric(updated_series, errors="coerce")
            if float(parsed.notna().sum()) / float(non_null_count) >= 0.8:
                updated_df[column] = parsed
            continue

        if pd.api.types.is_datetime64_any_dtype(previous_series):
            parsed = pd.to_datetime(updated_series, errors="coerce")
            if float(parsed.notna().sum()) / float(non_null_count) >= 0.8:
                updated_df[column] = parsed

    return updated_df


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
def clean_dataset(dataset_id: str) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    raw_df = dataset["raw"]
    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    cleaned_df, summary = _clean_dataframe(raw_df)
    dataset["cleaned"] = cleaned_df
    dataset["cleaning_summary"] = summary

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


@app.get("/datasets/{dataset_id}/visualize")
def visualize_dataset(dataset_id: str, stage: str = "latest") -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    df, resolved_stage = _select_dataframe(dataset, stage)

    return {
        "dataset_id": dataset_id,
        "stage": resolved_stage,
        "charts": _build_visualization_payload(df),
        "options": _get_chart_options(df),
    }


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

from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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
    column_profiles = [
        {
            "name": column,
            "dtype": str(df[column].dtype),
            "missing_values": int(df[column].isna().sum()),
            "non_null_values": int(df[column].notna().sum()),
        }
        for column in df.columns
    ]

    return {
        "rows": int(df.shape[0]),
        "columns_count": int(df.shape[1]),
        "columns": list(df.columns),
        "column_profiles": column_profiles,
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


def _clean_dataframe(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, object]]:
    cleaned_df = df.copy()
    rows_before = int(cleaned_df.shape[0])
    missing_before = int(cleaned_df.isna().sum().sum())

    placeholder_null_tokens = {
        "",
        " ",
        "-",
        "--",
        "n/a",
        "null",
        "none",
        "unknown",
    }
    date_keywords = ("date", "time", "created", "updated", "timestamp")
    name_like_keywords = ("name", "city", "department")
    no_title_case_keywords = ("email", "username", "id", "code", "acronym")

    def _column_matches_keywords(column_name: str, keywords: tuple[str, ...]) -> bool:
        normalized = column_name.lower()
        return any(keyword in normalized for keyword in keywords)

    def _is_name_like_column(column_name: str) -> bool:
        normalized = column_name.lower()
        return _column_matches_keywords(normalized, name_like_keywords) and not _column_matches_keywords(
            normalized, no_title_case_keywords
        )

    def _normalize_text_series(series: pd.Series) -> pd.Series:
        normalized = series.astype("string").str.strip().str.replace(r"\s+", " ", regex=True)
        normalized = normalized.mask(normalized.str.lower().isin(placeholder_null_tokens), pd.NA)
        return normalized

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

    cleaned_df = cleaned_df.replace([np.inf, -np.inf], np.nan)

    standardized_text_columns: list[str] = []
    object_like_columns = list(cleaned_df.select_dtypes(include=["object", "string"]).columns)
    for column in object_like_columns:
        column_name = str(column)
        original_series = cleaned_df[column].astype("string")
        normalized_series = _normalize_text_series(cleaned_df[column])

        if _is_name_like_column(column_name):
            normalized_series = normalized_series.str.title()

        if not original_series.equals(normalized_series):
            standardized_text_columns.append(column_name)

        cleaned_df[column] = normalized_series

    converted_columns: list[dict[str, str]] = []

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
        if parse_ratio <= 0.5:
            continue

        cleaned_df[column] = converted_series
        converted_columns.append(
            {"column": column_name, "to_type": "datetime", "new_dtype": str(cleaned_df[column].dtype)}
        )

    object_like_columns = list(cleaned_df.select_dtypes(include=["object", "string"]).columns)
    for column in object_like_columns:
        column_name = str(column)
        non_null_values = cleaned_df[column].dropna()
        if non_null_values.empty:
            continue

        sanitized_non_null = _sanitize_numeric_strings(non_null_values)
        parsed_non_null = pd.to_numeric(sanitized_non_null, errors="coerce")
        numeric_like_ratio = float(parsed_non_null.notna().sum()) / float(len(non_null_values))
        if numeric_like_ratio <= 0.5:
            continue

        cleaned_df[column] = pd.to_numeric(_sanitize_numeric_strings(cleaned_df[column]), errors="coerce")
        converted_columns.append(
            {"column": column_name, "to_type": "numeric", "new_dtype": str(cleaned_df[column].dtype)}
        )

    invalid_row_mask = cleaned_df.isna().all(axis=1)
    invalid_rows_removed = int(invalid_row_mask.sum())
    if invalid_rows_removed > 0:
        cleaned_df = cleaned_df.loc[~invalid_row_mask].copy()

    rows_before_deduplication = int(cleaned_df.shape[0])
    cleaned_df = cleaned_df.drop_duplicates().reset_index(drop=True)
    duplicates_removed = rows_before_deduplication - int(cleaned_df.shape[0])

    filled_numeric_mean = 0
    filled_numeric_median = 0
    filled_text_mode = 0
    filled_datetime_ffill = 0

    numeric_columns = list(cleaned_df.select_dtypes(include=["number"]).columns)
    for column in numeric_columns:
        missing_before_fill = int(cleaned_df[column].isna().sum())
        if missing_before_fill == 0:
            continue

        non_null_series = cleaned_df[column].dropna()
        if non_null_series.empty:
            continue

        skew_value = non_null_series.skew()
        use_median = bool(pd.notna(skew_value) and abs(float(skew_value)) > 1.0)
        fill_value = non_null_series.median() if use_median else non_null_series.mean()
        if pd.isna(fill_value):
            continue

        cleaned_df[column] = cleaned_df[column].fillna(fill_value)
        filled_count = max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)
        if use_median:
            filled_numeric_median += filled_count
        else:
            filled_numeric_mean += filled_count

    datetime_columns = list(cleaned_df.select_dtypes(include=["datetime", "datetimetz"]).columns)
    for column in datetime_columns:
        missing_before_fill = int(cleaned_df[column].isna().sum())
        if missing_before_fill == 0:
            continue
        if not _is_sequential_datetime(cleaned_df[column]):
            continue

        cleaned_df[column] = cleaned_df[column].ffill()
        filled_datetime_ffill += max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)

    text_columns = list(cleaned_df.select_dtypes(include=["object", "string"]).columns)
    for column in text_columns:
        missing_before_fill = int(cleaned_df[column].isna().sum())
        if missing_before_fill == 0:
            continue

        mode_values = cleaned_df[column].mode(dropna=True)
        if mode_values.empty:
            continue

        cleaned_df[column] = cleaned_df[column].fillna(mode_values.iloc[0])
        filled_text_mode += max(missing_before_fill - int(cleaned_df[column].isna().sum()), 0)

    missing_after = int(cleaned_df.isna().sum().sum())
    total_filled = filled_numeric_mean + filled_numeric_median + filled_text_mode + filled_datetime_ffill

    summary = {
        "rows_before": rows_before,
        "rows_after": int(cleaned_df.shape[0]),
        "duplicates_removed": duplicates_removed,
        "invalid_rows_removed": invalid_rows_removed,
        "missing_values_before": missing_before,
        "missing_values_after": missing_after,
        "missing_values_filled": int(total_filled),
        "filled_numeric_mean": int(filled_numeric_mean),
        "filled_numeric_median": int(filled_numeric_median),
        "filled_text_mode": int(filled_text_mode),
        "filled_datetime_ffill": int(filled_datetime_ffill),
        "converted_columns": converted_columns,
        "date_columns_converted": [
            item["column"] for item in converted_columns if item["to_type"] == "datetime"
        ],
        "numeric_columns_converted": [
            item["column"] for item in converted_columns if item["to_type"] == "numeric"
        ],
        "text_columns_standardized": standardized_text_columns,
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


@app.post("/datasets/{dataset_id}/clean")
def clean_dataset(dataset_id: str) -> dict[str, object]:
    dataset = _get_dataset(dataset_id)
    raw_df = dataset["raw"]
    if not isinstance(raw_df, pd.DataFrame):
        raise HTTPException(status_code=500, detail="Dataset state is invalid")

    cleaned_df, summary = _clean_dataframe(raw_df)
    dataset["cleaned"] = cleaned_df
    dataset["cleaning_summary"] = summary

    PLACEHOLDER_NULL_TOKENS = {
        "",
        " ",
        "-",
        "--",
        "n/a",
        "null",
        "none",
        "unknown",
    }

    CRITICAL_IDENTIFIER_KEYWORDS = (
        "id",
        "email",
        "primary_key",
        "primarykey",
        "username",
        "user_name",
    )

    REQUIRED_BUSINESS_KEYWORDS = (
        "last_name",
        "lastname",
        "surname",
        "department",
        "program",
    )

    NAME_LIKE_KEYWORDS = ("name", "city", "department")
    NO_TITLE_CASE_KEYWORDS = ("email", "username", "id", "code", "acronym")
    DATE_KEYWORDS = ("date", "time", "created", "updated", "timestamp", "at")
    SEMANTIC_NULL_TEXT_KEYWORDS = ("middle", "suffix", "notes", "remark", "comment", "description")


    def _normalize_text_series(series: pd.Series) -> pd.Series:
        normalized = series.astype("string").str.strip().str.replace(r"\s+", " ", regex=True)
        normalized = normalized.mask(normalized.str.lower().isin(PLACEHOLDER_NULL_TOKENS), pd.NA)
        return normalized


    def _column_matches_keywords(column_name: str, keywords: tuple[str, ...]) -> bool:
        normalized = column_name.lower()
        return any(keyword in normalized for keyword in keywords)


    def _is_name_like_column(column_name: str) -> bool:
        normalized = column_name.lower()
        return _column_matches_keywords(normalized, NAME_LIKE_KEYWORDS) and not _column_matches_keywords(
            normalized, NO_TITLE_CASE_KEYWORDS
        )


    def _is_sequential_datetime(series: pd.Series) -> bool:
        non_null = series.dropna()
        if len(non_null) < 3:
            return False
        return bool(non_null.is_monotonic_increasing)


    def _sanitize_numeric_strings(series: pd.Series) -> pd.Series:
        return (
            series.astype("string")
            .str.replace(",", "", regex=False)
            .str.replace(r"[\$€£₱]", "", regex=True)
            .str.replace(r"\s+", "", regex=True)
        )



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
    }

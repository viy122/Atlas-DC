# ATLAS Data Cleaning and Analytics System

ATLAS is a web-based data cleaning and analytics system for BAT403 - Foundations of Enterprise Data Management. It supports the required workflow:

`Upload -> Profile -> Clean -> Analyze -> Visualize`

The system accepts CSV and Excel files, profiles data quality, applies configurable cleaning rules, compares the original and cleaned datasets, generates insights, and builds an interactive dashboard.

## Project Objective

Raw business datasets often contain missing values, inconsistent formats, duplicated records, invalid values, and mixed data types. ATLAS addresses this problem by giving users one guided workflow for preparing tabular data and turning it into useful summaries, interpretations, and dashboard visuals.

## Core Features

- Upload CSV, XLSX, or XLS files
- Display uploaded data in an editable table
- Profile rows, columns, data types, missing values, uniqueness, and basic statistics
- Clean data using configurable rules
- Compare original versus cleaned records with changed cells highlighted
- Generate numeric summaries, frequent values, correlations, and simple interpretations
- Create interactive dashboards with bar, line, donut/pie, scatter, and histogram charts
- Filter dashboard data by category, number range, or date range
- Export cleaned CSV files and finalized dashboards as PNG or PDF
- Provide a sample dataset for testing and screenshots

## Cleaning Methods

ATLAS uses configurable cleaning rules so the user can explain why each transformation was applied:

| Method | Logic |
| --- | --- |
| Placeholder normalization | Converts blanks, `NA`, `null`, `unknown`, and dash values into real missing values. |
| Text standardization | Trims extra spacing and title-cases name or label fields. |
| Data type conversion | Converts trusted date-like and numeric-like columns into analysis-ready types. |
| Missing numeric handling | Fills numeric gaps with mean or median depending on skew and outliers. |
| Missing text handling | Preserves text nulls by default; optional mode fill is available. |
| Duplicate handling | Removes exact duplicate rows and flags duplicate identifier values. |
| Invalid data filtering | Drops rows with missing critical identifiers and flags invalid values. |
| Validation | Checks email format, numeric ranges, and future birthdate-style values. |

The Cleaning page also shows a decision log with the impact count, handling method, and rationale for each rule.

## System Pages

| Page | Purpose |
| --- | --- |
| Upload | Import CSV/Excel data, preview/edit rows, save edits, and export edited CSV. |
| Profile | Review dataset summary, detected data types, missing values, uniqueness, and numeric statistics. |
| Clean | Select cleaning rules, run the pipeline, review audit results, and compare original versus cleaned data. |
| Analyze | View generated interpretations, frequent values, correlations, quality warnings, and trend signals. |
| Visualize | Build an interactive dashboard with filters, custom charts, drag ordering, finalization, and export. |
| Docs | Access documentation notes, screenshot checklist, and the sample dataset. |

## Tech Stack

- Frontend: React, Vite, React Router, ApexCharts
- Backend: FastAPI, pandas, NumPy
- File support: CSV, XLSX, XLS
- Export support: CSV, PNG, PDF

## Setup

### Backend

```bash
cd backend
copy .env.example .env
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

After copying `.env.example`, open `backend/.env` and replace `your_gemini_api_key_here` with your Gemini API key:

```env
GEMINI_API_KEY=your_actual_key_here
```

The backend loads `backend/.env` automatically when it starts. If you change the key while the server is already running, stop and start the backend again.
The default Gemini model is `gemini-flash-latest`; you can override it with `GEMINI_MODEL` in `backend/.env`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## Sample Dataset

Use `frontend/public/sample_sales_dataset.csv` for defense and screenshots. It includes:

- Missing sales, quantity, and customer name values
- Duplicate order records
- Numeric values stored as text
- Placeholder values such as `unknown` and `-`
- Inconsistent customer name casing
- Date values for trend charts

## Defense Demo Flow

1. Open ATLAS and upload `sample_sales_dataset.csv`.
2. Show the uploaded table and explain that raw data can be edited before processing.
3. Go to Profile and point out rows, columns, types, missing values, uniqueness, and statistics.
4. Go to Clean, select the cleaning rules, then run the cleaning pipeline.
5. Explain the audit metrics and the decision log: what changed, how it was handled, and why.
6. Open Original vs Cleaned Dataset and show highlighted changed cells.
7. Go to Analyze and explain the generated summaries and interpretations.
8. Go to Visualize, use filters, customize a chart, and finalize/export the dashboard.
9. Go to Docs and show the sample dataset and screenshot checklist.

## Screenshot Checklist

Include these in the final documentation:

- Upload page with raw dataset loaded
- Profile page showing types and missing values
- Cleaning page showing rule controls and audit results
- Original vs cleaned comparison table
- Analysis page with generated insights
- Visualization page with dashboard charts and filters
- Exported or finalized dashboard

## Notes and Limitations

- Uploaded datasets are stored in backend memory for the current server session.
- This project is designed for class demonstration datasets, not large production data warehouses.
- Cleaning rules are intentionally explainable and conservative so the defense can justify each method.

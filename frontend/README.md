# ATLAS Data Cleaning and Analytics System

ATLAS is a mini Power BI-style workflow for uploading raw tabular data, profiling quality, cleaning common issues, generating insights, and building simple charts.

## Workflow

1. Upload: import a CSV, XLSX, or XLS file and preview the raw table.
2. Profile: review row and column counts, inferred data types, missing values, unique values, and basic numeric statistics.
3. Clean: run the automatic cleaning process and review the transformation summary.
4. Compare: inspect original vs cleaned values with changed cells highlighted.
5. Analyze: read summary statistics, frequent values, correlations, trends, and simple interpretations.
6. Visualize: choose chart type, dimension, measure, and aggregation for bar, line, or pie charts.

## Cleaning Methods

- Missing text placeholders such as blank values, `n/a`, `null`, `none`, and `unknown` are standardized.
- Duplicate rows are removed.
- Empty rows are filtered out.
- Numeric-looking text is converted into numeric columns where possible.
- Date-like columns are converted into datetime columns where possible.
- Numeric missing values are filled with mean or median depending on skew.
- Text missing values are filled with the most frequent value.
- Sequential datetime gaps are forward-filled when appropriate.

## Sample Dataset

Use `public/sample_sales_dataset.csv` to test the complete workflow. It intentionally includes missing values, duplicate rows, inconsistent text casing, numeric strings, and placeholder null values.

## Screenshots To Include In The Final Report

- Upload page after importing the sample dataset.
- Profile page showing data types and missing values.
- Cleaning page showing the original-vs-cleaned comparison.
- Analysis page showing generated insights.
- Visualization page showing a selected bar, line, or pie chart.

## Local Development

Start the backend from the repository root:

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Start the frontend:

```bash
cd frontend
npm install
npm run dev
```

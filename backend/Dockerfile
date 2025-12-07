FROM python:3.12-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for some python packages)
# Install system dependencies if needed (e.g. for some python packages)
RUN apt-get update && apt-get install -y --no-install-recommends gcc poppler-utils && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# pip install requests pandas

import requests
import json
import os
import pandas as pd
from datetime import datetime, timedelta

def get_stock_history(symbol: str, period: str = "1y", interval: str = "1d", start_date: str = None, end_date: str = None):
    """
    Fetch historical stock data from Yahoo Finance JSON API.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'AAPL')
        period: Time period ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max')
        interval: Data interval ('1m', '5m', '15m', '1h', '1d', '1wk', '1mo')
        start_date: Start date in 'YYYY-MM-DD' format (overrides period if provided)
        end_date: End date in 'YYYY-MM-DD' format (defaults to today)
    
    Returns:
        dict with timestamps and price data
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    
    params = {
        "interval": interval,
        "includePrePost": "false",
        "events": "div,splits"
    }
    
    # Use date range if provided, otherwise use period
    if start_date:
        start_ts = int(datetime.strptime(start_date, "%Y-%m-%d").timestamp())
        params["period1"] = start_ts
        if end_date:
            end_ts = int(datetime.strptime(end_date, "%Y-%m-%d").timestamp())
        else:
            end_ts = int(datetime.now().timestamp())
        params["period2"] = end_ts
    else:
        params["range"] = period
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    response = requests.get(url, params=params, headers=headers)
    response.raise_for_status()
    
    return response.json()


def generate_trading_calendar(start_date: str, end_date: str):
    """
    Generate a list of trading days (weekdays only, excluding weekends).
    Includes January 1st and fills missing trading days with previous data.
    
    Args:
        start_date: Start date in 'YYYY-MM-DD' format
        end_date: End date in 'YYYY-MM-DD' format
    
    Returns:
        List of date strings in 'YYYY/M/D' format (weekdays only)
    """
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    trading_days = []
    current = start
    
    while current <= end:
        # Only include weekdays (Monday=0 to Friday=4)
        if current.weekday() < 5:
            # Format as YYYY/M/D (no zero padding)
            date_str = f"{current.year}/{current.month}/{current.day}"
            trading_days.append(date_str)
        current += timedelta(days=1)
    
    return trading_days


def parse_stock_data(data: dict, trading_calendar: list):
    """
    Parse Yahoo Finance JSON response into a pandas DataFrame.
    Fill missing trading days (holidays, weekends) with previous available data.
    If no previous data exists (e.g., Jan 1st is first day), use most recent data.
    
    Args:
        data: Yahoo Finance API response
        trading_calendar: List of all expected trading days in 'YYYY/M/D' format
    
    Returns:
        DataFrame with complete trading calendar
    """
    result = data["chart"]["result"][0]
    timestamps = result["timestamp"]
    quote = result["indicators"]["quote"][0]
    
    # Parse actual data from Yahoo Finance
    actual_data = {}
    for i, ts in enumerate(timestamps):
        dt = datetime.fromtimestamp(ts)
        # Format as YYYY/M/D (no zero padding)
        date_str = f"{dt.year}/{dt.month}/{dt.day}"
        actual_data[date_str] = {
            "close": quote["close"][i],
            "volume": quote["volume"][i]
        }
    
    # Build complete DataFrame with trading calendar
    rows = []
    prev_close = None
    prev_volume = None
    
    for date_str in trading_calendar:
        if date_str in actual_data:
            close = actual_data[date_str]["close"]
            volume = actual_data[date_str]["volume"]
            
            # Handle None values from API
            if close is not None:
                prev_close = close
            else:
                close = prev_close
            
            if volume is not None:
                prev_volume = volume
            else:
                volume = prev_volume
        else:
            # Holiday or missing data - use previous day's data
            # If no previous data exists, will be filled by forward fill later
            close = prev_close
            volume = prev_volume
        
        rows.append({
            "date": date_str,
            "close": close,
            "volume": volume
        })
    
    df = pd.DataFrame(rows)
    
    # Forward fill any remaining None values (for first day if no previous data)
    # First backward fill to handle start of data, then forward fill for rest
    df["close"] = df["close"].bfill().ffill()
    
    # For volume, convert to float first to use bfill, then to int
    df["volume"] = df["volume"].astype(float)
    df["volume"] = df["volume"].bfill().fillna(0)
    
    # Round price columns to 3 decimal places
    df["close"] = df["close"].round(3)
    
    # Convert volume to integer
    df["volume"] = df["volume"].astype(int)
    
    return df


def main():
    symbols = [
        "NVDA", "V", "SHW", "CSCO", "DIS", "TRV", "JPM", "MCD", "AMZN", "MRK",
        "AMGN", "VZ", "MSFT", "AAPL", "AXP", "UNH", "MMM", "IBM", "WMT", "GS",
        "CVX", "PG", "CAT", "KO", "HON", "HD", "JNJ", "BA", "CRM", "NKE"
    ]
    start_date = "2014-01-01"
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    # Generate trading calendar (all weekdays from start to end)
    trading_calendar = generate_trading_calendar(start_date, end_date)
    print(f"Trading calendar: {len(trading_calendar)} days from {trading_calendar[0]} to {trading_calendar[-1]}")
    print()
    
    # Output to current directory (same level as this script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    for symbol in symbols:
        print(f"Fetching {symbol} stock data from {start_date} to today...")
        
        try:
            # Fetch JSON data from Yahoo Finance
            data = get_stock_history(symbol, interval="1d", start_date=start_date)
            
            # Save raw JSON
            with open(f"{symbol}_raw.json", "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            print(f"Raw JSON saved to {symbol}_raw.json")
            
            # Parse to DataFrame with trading calendar
            df = parse_stock_data(data, trading_calendar)
            
            # Save to CSV
            csv_filename = os.path.join(script_dir, f"{symbol}_history.csv")
            df.to_csv(csv_filename, index=False)
            print(f"CSV saved to {csv_filename}")
            
            # Display summary
            print(f"Total records: {len(df)}, Date range: {df['date'].iloc[0]} to {df['date'].iloc[-1]}")
            print()
        except Exception as e:
            print(f"Error fetching {symbol}: {e}")
            print()


if __name__ == "__main__":
    main()

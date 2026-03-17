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
            "open": quote["open"][i],
            "high": quote["high"][i],
            "low": quote["low"][i],
            "close": quote["close"][i],
            "volume": quote["volume"][i]
        }
    
    # Build complete DataFrame with trading calendar
    rows = []
    prev_open = None
    prev_high = None
    prev_low = None
    prev_close = None
    prev_volume = None
    
    # Initialize prev_* with data before trading_calendar starts (e.g., 2012/12/31 for 2013/1/1)
    if trading_calendar:
        parts = trading_calendar[0].split("/")
        first_calendar_date = datetime(int(parts[0]), int(parts[1]), int(parts[2]))
        
        # Find the most recent data before the first calendar date
        latest_before_start = None
        latest_before_start_values = None
        for date_str, values in actual_data.items():
            parts = date_str.split("/")
            dt = datetime(int(parts[0]), int(parts[1]), int(parts[2]))
            if dt < first_calendar_date and values["close"] is not None:
                if latest_before_start is None or dt > latest_before_start:
                    latest_before_start = dt
                    latest_before_start_values = values
        
        if latest_before_start_values:
            prev_open = latest_before_start_values["open"]
            prev_high = latest_before_start_values["high"]
            prev_low = latest_before_start_values["low"]
            prev_close = latest_before_start_values["close"]
            prev_volume = latest_before_start_values["volume"]
    
    for date_str in trading_calendar:
        if date_str in actual_data:
            open_price = actual_data[date_str]["open"]
            high = actual_data[date_str]["high"]
            low = actual_data[date_str]["low"]
            close = actual_data[date_str]["close"]
            volume = actual_data[date_str]["volume"]
            
            # Handle None values from API
            if open_price is not None:
                prev_open = open_price
            else:
                open_price = prev_open
            
            if high is not None:
                prev_high = high
            else:
                high = prev_high
            
            if low is not None:
                prev_low = low
            else:
                low = prev_low
            
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
            open_price = prev_open
            high = prev_high
            low = prev_low
            close = prev_close
            volume = prev_volume
        
        rows.append({
            "date": date_str,
            "open": open_price,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume
        })
    
    df = pd.DataFrame(rows)
    
    # Forward fill any remaining None values (for first day if no previous data)
    # First backward fill to handle start of data, then forward fill for rest
    df["open"] = df["open"].bfill().ffill()
    df["high"] = df["high"].bfill().ffill()
    df["low"] = df["low"].bfill().ffill()
    df["close"] = df["close"].bfill().ffill()
    
    # For volume, convert to float first to use bfill, then to int
    df["volume"] = df["volume"].astype(float)
    df["volume"] = df["volume"].bfill().fillna(0)
    
    # Format price columns to 2 decimal places (with trailing zeros)
    df["open"] = df["open"].round(2).apply(lambda x: f"{x:.2f}")
    df["high"] = df["high"].round(2).apply(lambda x: f"{x:.2f}")
    df["low"] = df["low"].round(2).apply(lambda x: f"{x:.2f}")
    df["close"] = df["close"].round(2).apply(lambda x: f"{x:.2f}")
    
    # Convert volume to integer
    df["volume"] = df["volume"].astype(int)
    
    return df


def main():
    symbols = [
        "NVDA", "V", "SHW", "CSCO", "DIS", "TRV", "JPM", "MCD", "AMZN", "MRK",
        "AMGN", "VZ", "MSFT", "AAPL", "AXP", "UNH", "MMM", "IBM", "WMT", "GS",
        "CVX", "PG", "CAT", "KO", "HON", "HD", "JNJ", "BA", "CRM", "NKE", "SPY", "DIA"
    ]
    fetch_start_date = "2012-12-31"  # 從這天開始抓資料，確保 2013/1/1 有前一天的資料可用
    calendar_start_date = "2013-01-01"  # trading calendar 從這天開始
    end_date = datetime.now().strftime("%Y-%m-%d")
    
    # Generate trading calendar (all weekdays from start to end)
    trading_calendar = generate_trading_calendar(calendar_start_date, end_date)
    print(f"Trading calendar: {len(trading_calendar)} days from {trading_calendar[0]} to {trading_calendar[-1]}")
    print()
    
    # Output to current directory (same level as this script)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    for symbol in symbols:
        print(f"Fetching {symbol} stock data from {fetch_start_date} to today...")
        
        try:
            # Fetch JSON data from Yahoo Finance
            data = get_stock_history(symbol, interval="1d", start_date=fetch_start_date)
            
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

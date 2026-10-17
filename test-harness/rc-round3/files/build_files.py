import os
import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill
import zipfile
import xml.etree.ElementTree as ET

OUT_DIR = r"C:\Users\admin\AppData\Local\Temp\de-rc-customer-testing\real-world-files"
os.makedirs(OUT_DIR, exist_ok=True)

# -------------------------------------------------------------
# 1. 1904 Date System (Mac Excel)
# -------------------------------------------------------------
# Mac Excel uses the 1904 date system (epoch 1904-01-01).
# In OOXML, workbookPr date1904="1" (or date1904="true").
# In openpyxl: wb.epoch = openpyxl.date_types.EPOCH_1904
def build_1904_dates():
    import openpyxl.utils.datetime as dt
    wb = openpyxl.Workbook()
    wb.epoch = dt.CALENDAR_MAC_1904
    ws = wb.active
    ws.title = "Employees"
    ws.append(["Name", "BirthDate", "JoinDate"])
    # Known dates:
    # 2026-05-15 (modern date)
    # 1904-01-02 (day 1 in 1904 epoch)
    # 1985-10-26 (Back to the Future date)
    ws.append(["Alice Mac", datetime.date(2026, 5, 15), datetime.date(1904, 1, 2)])
    ws.append(["Bob Mac", datetime.date(1985, 10, 26), datetime.date(2020, 3, 1)])
    
    path = os.path.join(OUT_DIR, "case1_1904_dates.xlsx")
    wb.save(path)
    print(f"Created {path}")

# -------------------------------------------------------------
# 2. Numeric cells holding identifiers mapped to string fields
# -------------------------------------------------------------
# In Excel, if numbers are pasted or typed without a leading apostrophe or text format,
# they are stored as raw float/integers:
# - 10-digit phone: 9876543210
# - 16-digit ID: 1234567890123456
# - Pincode: 600001 and 012345 (which Excel stores as 12345 if numeric)
# - Whole number: 42
def build_numeric_identifiers():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Identifiers"
    ws.append(["Name", "Phone", "NationalID", "PostalCode", "ItemCount"])
    # Row 1: Alice
    ws.append(["Alice", 9876543210, 1234567890123456, 600001, 42])
    # Row 2: Bob (with pincode that had a leading zero entered numerically: 12345)
    ws.append(["Bob", 8765432109, 9876543210987654, 12345, 100])
    
    path = os.path.join(OUT_DIR, "case2_numeric_identifiers.xlsx")
    wb.save(path)
    print(f"Created {path}")

# -------------------------------------------------------------
# 3. CSV Flavors & LibreOffice xlsx
# -------------------------------------------------------------
def build_csv_flavors_and_libreoffice():
    # 3a. Excel "CSV UTF-8" (BOM)
    # Excel exports with UTF-8 BOM (\xef\xbb\xbf), comma separator, CRLF
    bom_csv_path = os.path.join(OUT_DIR, "case3_excel_utf8_bom.csv")
    with open(bom_csv_path, "wb") as f:
        content = "\ufeffName,Department,Salary\r\nAlice,Engineering,75000\r\nBob,Design,65000\r\n".encode("utf-8")
        f.write(content)
    print(f"Created {bom_csv_path}")

    # 3b. Excel Semicolon CSV
    # European Excel uses ';' delimiter, comma decimal, CRLF
    semicolon_csv_path = os.path.join(OUT_DIR, "case3_excel_semicolon.csv")
    with open(semicolon_csv_path, "w", encoding="utf-8", newline="") as f:
        f.write("Product;Price;Rating\r\nWidget A;12,50;4,8\r\nWidget B;99,95;4,2\r\n")
    print(f"Created {semicolon_csv_path}")

    # 3c. Google Sheets CSV export
    # Google Sheets CSV exports standard UTF-8 (no BOM), commas, quotes for multiline/commas, LF or CRLF
    gsheets_csv_path = os.path.join(OUT_DIR, "case3_google_sheets.csv")
    with open(gsheets_csv_path, "w", encoding="utf-8", newline="") as f:
        f.write('Order ID,Customer,Address,Notes\n'
                '1001,"Smith, John","123 Main St\nApt 4B","Special order: ""fragile"""\n'
                '1002,"Doe, Jane","456 Oak Ave","Standard delivery"\n')
    print(f"Created {gsheets_csv_path}")

    # 3d. LibreOffice Calc xlsx
    # LibreOffice Calc sets <Application>LibreOffice/...</Application> in docProps/app.xml
    # We construct a workbook with openpyxl, save it, and then set the Application metadata to LibreOffice Calc
    lo_path = os.path.join(OUT_DIR, "case3_libreoffice.xlsx")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(["SKU", "Title", "Stock", "Price"])
    ws.append(["LO-001", "Libre Book", 15, 29.99])
    ws.append(["LO-002", "Libre Pen", 120, 1.50])
    wb.save(lo_path)

    # Inject LibreOffice app metadata into docProps/app.xml
    temp_zip = lo_path + ".tmp"
    with zipfile.ZipFile(lo_path, 'r') as zin, zipfile.ZipFile(temp_zip, 'w') as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'docProps/app.xml':
                # Replace Application tag
                text = data.decode('utf-8')
                text = text.replace("<Application>openpyxl</Application>", "<Application>LibreOffice/7.6.4.1$Windows_X86_64 LibreOffice_project/e19e1bde57601f84236a4f9408b4097424095a18</Application>")
                data = text.encode('utf-8')
            zout.writestr(item, data)
    os.replace(temp_zip, lo_path)
    print(f"Created {lo_path}")

# -------------------------------------------------------------
# 4. Complex xlsx: merged headers, hidden column, formulas, 2 sheets, empty trailing rows, duplicate headers
# -------------------------------------------------------------
def build_complex_xlsx():
    wb = openpyxl.Workbook()
    
    # Sheet 1: Main Data
    ws1 = wb.active
    ws1.title = "Sales"
    
    # Merged header in row 1: A1:B1 merged ("Customer Details"), C1 "Quantity", D1 "Unit Price", E1 "Total (Formula)", F1 "Hidden Note", G1 "Status", H1 "Status" (Duplicate header!)
    # Note: Merged cells in Excel: A1 has value "Customer Details", B1 is empty cell covered by merge.
    # In row 2 or row 1: let's test merged cells right in header row 1:
    # A1:B1 merged "Customer Info", C1 "Qty", D1 "Price", E1 "Total", F1 "Secret", G1 "Status", H1 "Status"
    ws1.merge_cells("A1:B1")
    ws1["A1"] = "Customer Info"
    ws1["C1"] = "Qty"
    ws1["D1"] = "Price"
    ws1["E1"] = "Total"
    ws1["F1"] = "Secret"
    ws1["G1"] = "Status"
    ws1["H1"] = "Status" # Duplicate header name!
    
    # Hidden column F (Secret)
    ws1.column_dimensions['F'].hidden = True
    
    # Data rows:
    # Row 2
    ws1["A2"] = "Acme Corp"
    ws1["B2"] = "North America"
    ws1["C2"] = 10
    ws1["D2"] = 25.5
    ws1["E2"] = "=C2*D2" # Formula!
    ws1["F2"] = "Internal discount applied"
    ws1["G2"] = "Pending"
    ws1["H2"] = "Active"
    
    # Row 3
    ws1["A3"] = "Globex"
    ws1["B3"] = "Europe"
    ws1["C3"] = 4
    ws1["D3"] = 100.0
    ws1["E3"] = "=C3*D3" # Formula!
    ws1["F3"] = "VIP client"
    ws1["G3"] = "Shipped"
    ws1["H3"] = "Archived"

    # Trailing empty rows: row 4, 5, 6, 7, 8, 9, 10
    # Let's add styling / borders to row 4-7 so Excel treats them as formatted/empty rows
    for r in range(4, 11):
        for c in range(1, 9):
            cell = ws1.cell(row=r, column=c)
            cell.font = Font(italic=True)
            # empty value!
    
    # Sheet 2: Notes / Instructions (second sheet)
    ws2 = wb.create_sheet(title="Instructions")
    ws2.append(["Instructions for sales import"])
    ws2.append(["Do not modify formulas in column E."])
    
    path = os.path.join(OUT_DIR, "case4_complex_sheet.xlsx")
    wb.save(path)

    # In Excel, formula cells have cached values <v>255</v> and <v>400</v>.
    # openpyxl writes empty <v></v> because it does not evaluate formulas.
    # We inject the cached values to faithfully represent Excel's saved workbook.
    temp_zip = path + ".tmp"
    with zipfile.ZipFile(path, 'r') as zin, zipfile.ZipFile(temp_zip, 'w') as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'xl/worksheets/sheet1.xml':
                text = data.decode('utf-8')
                text = text.replace('<c r="E2"><f>C2*D2</f><v></v></c>', '<c r="E2"><f>C2*D2</f><v>255</v></c>')
                text = text.replace('<c r="E3"><f>C3*D3</f><v></v></c>', '<c r="E3"><f>C3*D3</f><v>400</v></c>')
                data = text.encode('utf-8')
            zout.writestr(item, data)
    os.replace(temp_zip, path)
    print(f"Created {path}")

# -------------------------------------------------------------
# 5. Non-Latin text (Tamil, emoji) in headers and cells
# -------------------------------------------------------------
def build_non_latin():
    # 5a. XLSX with Tamil and Emojis
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "UnicodeData"
    
    # Headers with Tamil and Emoji:
    # பெயர் (Name), மின்னஞ்சல் (Email), 📦 ஆர்டர் எண் (Order ID), 💰 தொகை (Amount), 🚀 நிலை (Status)
    headers = ["பெயர்", "மின்னஞ்சல்", "📦 ஆர்டர் எண்", "💰 தொகை", "🚀 நிலை"]
    ws.append(headers)
    
    ws.append(["கார்த்திக் சுந்தரம்", "karthik@example.com", "ORD-IN-101", 12500.50, "✅ வழங்கப்பட்டது"])
    ws.append(["மலர்விழி செல்வம்", "malar@example.com", "ORD-IN-102", 4500.00, "⚡ செயலாக்கத்தில் உள்ளது"])
    ws.append(["Rajesh Kumar 🎉", "rajesh@example.com", "ORD-IN-103", 890.00, "❌ ரத்து செய்யப்பட்டது"])
    
    xlsx_path = os.path.join(OUT_DIR, "case5_non_latin.xlsx")
    wb.save(xlsx_path)
    print(f"Created {xlsx_path}")

    # 5b. CSV with Tamil and Emojis (UTF-8)
    csv_path = os.path.join(OUT_DIR, "case5_non_latin.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.write(",".join(headers) + "\n")
        f.write('"கார்த்திக் சுந்தரம்",karthik@example.com,ORD-IN-101,12500.50,"✅ வழங்கப்பட்டது"\n')
        f.write('"மலர்விழி செல்வம்",malar@example.com,ORD-IN-102,4500.00,"⚡ செயலாக்கத்தில் உள்ளது"\n')
        f.write('"Rajesh Kumar 🎉",rajesh@example.com,ORD-IN-103,890.00,"❌ ரத்து செய்யப்பட்டது"\n')
    print(f"Created {csv_path}")

if __name__ == "__main__":
    build_1904_dates()
    build_numeric_identifiers()
    build_csv_flavors_and_libreoffice()
    build_complex_xlsx()
    build_non_latin()

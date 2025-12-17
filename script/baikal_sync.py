import mysql.connector
import requests
import hmac
import hashlib
import os
import sys
from dotenv import load_dotenv

# ================= CẤU HÌNH CƠ BẢN =================
# Load biến môi trường
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(dotenv_path=env_path)

MY_SECRET_SEED = os.getenv('MY_SECRET_SEED', '')
BAIKAL_PUBLIC_URL = os.getenv('BAIKAL_PUBLIC_URL', "https://carddav.minhbv.com")
BAIKAL_BASE_URL = f"{BAIKAL_PUBLIC_URL.rstrip('/')}/dav.php"
DB_CONFIG = {
    'user': os.getenv('DB_USER', 'baikal_user'),
    'password': os.getenv('DB_PASSWORD', ''),
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'baikal'),
    'raise_on_warnings': True
}

# Tên address book mặc định của Baikal
MASTER_AB_URI = "default"

def generate_deterministic_password(username, secret_key):
    """Sinh password cố định từ username + secret key (HMAC-SHA256)."""
    if not secret_key:
        print("[ERROR] Chưa cấu hình MY_SECRET_SEED trong .env")
        sys.exit(1)

    key_bytes = secret_key.encode('utf-8')
    msg_bytes = username.encode('utf-8')
    signature = hmac.new(key_bytes, msg_bytes, hashlib.sha256).hexdigest()
    return signature[:16]

def get_db_connection():
    """Hàm wrapper để tạo kết nối DB"""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"[FATAL] Không thể kết nối DB: {err}")
        sys.exit(1)

def discover_masters():
    """
    [NEW] Quét DB để tìm tất cả các user đóng vai trò Master.
    Quy ước: User master phải có đuôi là '_master'
    """
    masters = []
    cnx = get_db_connection()
    cursor = cnx.cursor()

    # Tìm tất cả uri kết thúc bằng _master
    # Ví dụ uri: principals/ctya_master
    query = "SELECT uri FROM principals WHERE uri LIKE '%_master'"

    cursor.execute(query)

    for (uri,) in cursor:
        if isinstance(uri, bytes):
            uri = uri.decode('utf-8')

        # Lấy username từ uri (bỏ phần principals/)
        username = uri.split('/')[-1]

        # Suy diễn Tenant Prefix từ username master
        # Ví dụ: ctya_master -> prefix là "ctya_"
        prefix = username.replace("master", "")

        masters.append({
            "username": username,
            "prefix": prefix
        })

    cursor.close()
    cnx.close()
    return masters

def get_tenant_contacts(prefix, master_username):
    """
    Lấy contact của các nhân viên thuộc tenant (dựa vào prefix),
    TRỪ contact của chính ông Master đó ra.
    """
    contacts = []
    cnx = get_db_connection()
    cursor = cnx.cursor()

    query = ("""
        SELECT c.carddata, p.uri, c.uri
        FROM cards c
        JOIN addressbooks ab ON c.addressbookid = ab.id
        JOIN principals p ON ab.principaluri = p.uri
        WHERE p.uri LIKE %s
        AND p.uri != %s
    """)

    # Tìm tất cả user bắt đầu bằng prefix (VD: principals/ctya_%)
    search_pattern = f"principals/{prefix}%"
    master_uri = f"principals/{master_username}"

    cursor.execute(query, (search_pattern, master_uri))

    for (carddata, user_uri, card_uri) in cursor:
        # Decode dữ liệu
        if isinstance(carddata, bytes): carddata = carddata.decode('utf-8')
        if isinstance(user_uri, bytes): user_uri = user_uri.decode('utf-8')
        if isinstance(card_uri, bytes): card_uri = card_uri.decode('utf-8')

        clean_username = user_uri.split('/')[-1]

        contacts.append({
            'owner': clean_username,
            'original_id': card_uri,
            'vcard': carddata
        })

    cursor.close()
    cnx.close()
    return contacts

def sync_one_tenant(master_info):
    """Thực hiện quy trình đồng bộ cho 1 Tenant cụ thể"""
    master_user = master_info['username']
    prefix = master_info['prefix']

    print(f"\n>>> Đang xử lý Tenant: {prefix.upper()} (Master: {master_user})")

    # 1. Sinh password động cho Master này
    master_pass = generate_deterministic_password(master_user, MY_SECRET_SEED)

    # 2. Lấy danh bạ nhân viên của Tenant này
    contacts = get_tenant_contacts(prefix, master_user)
    print(f"    - Tìm thấy {len(contacts)} contacts nhân viên.")

    if not contacts:
        return

    # 3. Đẩy vào Address Book của Master
    target_url = f"{BAIKAL_BASE_URL}/addressbooks/{master_user}/{MASTER_AB_URI}/"
    auth = requests.auth.HTTPDigestAuth(master_user, master_pass)
    headers = {"Content-Type": "text/vcard; charset=utf-8"}

    success_count = 0

    with requests.Session() as session:
        session.auth = auth
        session.headers.update(headers)

        for contact in contacts:
            # Tạo tên file IDEMPOTENT: prefix_nhanvien1_filename-goc.vcf
            # Đảm bảo duy nhất toàn cục kể cả nếu tên file gốc trùng nhau giữa các tenant
            safe_filename = f"sync_{contact['owner']}_{contact['original_id']}"
            if not safe_filename.endswith('.vcf'):
                safe_filename += ".vcf"

            full_url = target_url + safe_filename

            try:
                # PUT request: Update nếu có rồi, Create nếu chưa có
                res = session.put(full_url, data=contact['vcard'].encode('utf-8'))
                if res.status_code in [200, 201, 204]:
                    success_count += 1
                else:
                    print(f"    [WARN] Lỗi {res.status_code} khi đẩy {safe_filename}")
            except Exception as e:
                print(f"    [ERROR] Lỗi kết nối: {e}")

    print(f"    [DONE] Đã đồng bộ {success_count}/{len(contacts)} contacts vào tài khoản {master_user}.")

# ================= MAIN =================
if __name__ == "__main__":
    print("--- BẮT ĐẦU QUÁ TRÌNH AUTO-SYNC ĐA TENANT ---")

    # Bước 1: Tìm tất cả các Master
    masters = discover_masters()

    if not masters:
        print("[INFO] Không tìm thấy user nào có đuôi '_master' trong DB.")
    else:
        print(f"[INFO] Tìm thấy {len(masters)} Master users: {[m['username'] for m in masters]}")

        # Bước 2: Lặp qua từng Master để xử lý
        for master in masters:
            sync_one_tenant(master)

    print("\n--- HOÀN TẤT ---")
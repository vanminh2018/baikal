# Baïkal with Automatic User Creation API

Dự án này bao gồm Baïkal (CalDAV/CardDAV server) và một API Node.js để tự động tạo người dùng.

## Cấu trúc dự án

```
.
├── baikal-api/          # API Node.js để tạo user tự động
│   ├── Dockerfile       # Dockerfile cho API
│   ├── package.json     # Dependencies của Node.js
│   └── server.js        # Source code API
├── config/              # Thư mục cấu hình Baïkal
│   └── baikal.yaml      # File cấu hình Baïkal
├── Specific/           # Data directory của Baïkal
│   └── db/             # Database files
├── docker-compose.yml   # Docker Compose configuration
├── .env.example        # File mẫu biến môi trường
└── README.md           # File này
```

## Cài đặt

1. Clone repository:

```bash
git clone <repository-url>
cd baikal
```

2. Sao chép file biến môi trường:

```bash
cp .env.example .env
```

3. Chỉnh sửa file `.env` với các giá trị phù hợp:

```bash
# Baïkal Configuration
BAIKAL_PORT=8080
BAIKAL_AUTH_TYPE=Digest
BAIKAL_REALM=NEWREALM
BAIKAL_PUBLIC_URL=http://localhost:8080

# Database Configuration
DB_HOST=192.168.2.241
DB_PORT=3306
DB_USER=baikal_user
DB_PASSWORD=your_database_password
DB_NAME=baikal

# API Configuration
API_PORT=3000
API_SECRET=your_secret_api_key_here
```

4. Khởi động dịch vụ:

```bash
docker compose up -d
```

## Sử dụng API

API cung cấp endpoint để tạo người dùng Baïkal tự động.

### Endpoint: POST /api/create-tenant

**Headers:**

- `X-API-Key`: API key từ biến môi trường `API_SECRET`

**Body:**

```json
{
  "username": "testuser",
  "password": "password123",
  "displayName": "Test User",
  "email": "test@example.com"
}
```

**Response:**

```json
{
  "success": true,
  "username": "testuser",
  "realm": "NEWREALM",
  "cardDavUrl": "http://localhost:8080/dav.php/addressbooks/testuser/default/"
}
```

**Ví dụ sử dụng curl:**

```bash
curl -X POST http://localhost:3000/api/create-tenant \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_secret_api_key_here" \
  -d '{
    "username": "testuser",
    "password": "password123",
    "displayName": "Test User",
    "email": "test@example.com"
  }'
```

## Cách đổi Realm

Realm là một phần quan trọng của xác thực Baïkal. Để đổi realm:

1. **Chỉnh lại `.env`**:

   ```bash
   BAIKAL_REALM=NEW_REALM_NAME
   ```

2. **Chỉnh lại `config/baikal.yaml`**:

   ```yaml
   system:
     auth_realm: NEW_REALM_NAME
   ```

3. **Tạo password hash cho admin**:

   ```bash
   echo -n 'admin:NEW_REALM_NAME:Passwd123' | sha256sum
   ```

   Sau đó cập nhật `admin_passwordhash` trong `config/baikal.yaml` với kết quả.

4. **Khởi động lại dịch vụ**:
   ```bash
   docker compose build --pull --no-cache && docker compose down --remove-orphans && docker compose up -d --wait && docker compose logs -f --tail 100
   ```

## Xem logs

Để xem logs của tất cả services:

```bash
docker compose logs -f
```

Để xem logs của một service cụ thể:

```bash
docker compose logs -f baikal
docker compose logs -f baikal-api
```

## Tối ưu hóa Docker

Dự án sử dụng Dockerfile tối ưu với các tính năng:

- Multi-stage build để giảm kích thước image
- Non-root user để tăng bảo mật
- Cache optimization để tăng tốc độ build
- Production-only dependencies

## Lưu ý bảo mật

- Luôn thay đổi `API_SECRET` mặc định
- Sử dụng password mạnh cho database
- Không commit file `.env` vào repository
- Sử dụng HTTPS trong production

## Troubleshooting

### Lỗi kết nối database

Kiểm tra các biến môi trường DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME trong file `.env`.

### Lỗi xác thực API

Đảm bảo header `X-API-Key` được gửi với giá trị đúng từ biến môi trường `API_SECRET`.

### Lỗi tạo user trùng lặp

API sẽ trả về lỗi 409 nếu username đã tồn tại. Sử dụng username khác.

## License

[License của dự án]

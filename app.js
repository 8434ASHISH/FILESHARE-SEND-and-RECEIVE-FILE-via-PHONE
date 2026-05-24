/* ============================================
   FILESHARE P2P WEBSITE - APPLICATION LOGIC
   ============================================ */

const CONFIG = {
    SIGNALING_SERVER: 'https://fileshare-signaling.8434ashishranjan.workers.dev',
    MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5GB
    CHUNK_SIZE: 64 * 1024, // 64KB chunks
};

let state = {
    mode: 'scanner', // scanner, manual, send, receive
    socket: null,
    peerConnection: null,
    dataChannel: null,
    selectedFiles: [],
    roomCode: '',
    isReceiver: false,
    receivedData: [],
    qrScanner: null,
};

// ==========================================
// DOM ELEMENTS
// ==========================================

const elements = {
    // Modes
    scannerMode: document.getElementById('scannerMode'),
    manualMode: document.getElementById('manualMode'),
    sendMode: document.getElementById('sendMode'),
    receiveMode: document.getElementById('receiveMode'),
    
    // Scanner
    qrScanner: document.getElementById('qrScanner'),
    manualEntryBtn: document.getElementById('manualEntryBtn'),
    
    // Manual Entry
    roomCodeInput: document.getElementById('roomCodeInput'),
    connectManualBtn: document.getElementById('connectManualBtn'),
    backToScannerBtn: document.getElementById('backToScannerBtn'),
    
    // Send
    mobileDropZone: document.getElementById('mobileDropZone'),
    mobileFileInput: document.getElementById('mobileFileInput'),
    mobileFileList: document.getElementById('mobileFileList'),
    mobileSendBtn: document.getElementById('mobileSendBtn'),
    mobileSendProgress: document.getElementById('mobileSendProgress'),
    mobileSendFill: document.getElementById('mobileSendFill'),
    mobileSendPercent: document.getElementById('mobileSendPercent'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    
    // Receive
    waitingSection: document.getElementById('waitingSection'),
    receiveProgressSection: document.getElementById('receiveProgressSection'),
    receiveFill: document.getElementById('receiveFill'),
    receivePercent: document.getElementById('receivePercent'),
    receiveFileName: document.getElementById('receiveFileName'),
    mobileReceivedList: document.getElementById('mobileReceivedList'),
    mobileDownloadSection: document.getElementById('mobileDownloadSection'),
    mobileDownloadBtn: document.getElementById('mobileDownloadBtn'),
    newTransferBtn: document.getElementById('newTransferBtn'),
    disconnectReceiveBtn: document.getElementById('disconnectReceiveBtn'),
    
    // Toast
    toastContainer: document.getElementById('toastContainer'),
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkQRCodeParam();
    initializeQRScanner();
});

function initializeEventListeners() {
    // Scanner Mode
    elements.manualEntryBtn.addEventListener('click', switchToManual);
    elements.backToScannerBtn.addEventListener('click', switchToScanner);
    
    // Manual Mode
    elements.roomCodeInput.addEventListener('input', updateConnectButtonState);
    elements.connectManualBtn.addEventListener('click', connectToRoom);
    
    // Send Mode
    elements.mobileDropZone.addEventListener('click', () => elements.mobileFileInput.click());
    elements.mobileDropZone.addEventListener('dragover', handleDragOver);
    elements.mobileDropZone.addEventListener('dragleave', handleDragLeave);
    elements.mobileDropZone.addEventListener('drop', handleDrop);
    elements.mobileFileInput.addEventListener('change', handleFileSelect);
    elements.mobileSendBtn.addEventListener('click', sendFilesViaPeer);
    elements.disconnectBtn.addEventListener('click', disconnect);
    
    // Receive Mode
    elements.mobileDownloadBtn.addEventListener('click', downloadReceivedFiles);
    elements.newTransferBtn.addEventListener('click', () => {
        state.receivedData = [];
        state.mode = 'receive';
        switchMode('receiveMode');
        showToast('Ready for new transfer', 'success');
    });
    elements.disconnectReceiveBtn.addEventListener('click', disconnect);
}

function checkQRCodeParam() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    
    if (room && room.length === 9) {
        state.roomCode = room.toUpperCase();
        connectToRoom();
    }
}

// ==========================================
// MODE SWITCHING
// ==========================================

function switchToManual() {
    state.mode = 'manual';
    switchMode('manualMode');
    elements.roomCodeInput.focus();
}

function switchToScanner() {
    state.mode = 'scanner';
    switchMode('scannerMode');
}

function switchMode(modeId) {
    // Hide all modes
    elements.scannerMode.classList.add('hidden');
    elements.manualMode.classList.add('hidden');
    elements.sendMode.classList.add('hidden');
    elements.receiveMode.classList.add('hidden');
    
    // Show selected mode
    document.getElementById(modeId).classList.remove('hidden');
}

// ==========================================
// QR SCANNER INITIALIZATION
// ==========================================

function initializeQRScanner() {
    if (!window.Html5Qrcode) {
        console.log('QR Scanner library not yet loaded');
        return;
    }

    try {
        // Simple QR detection via camera
        const constraints = {
            video: { facingMode: 'environment' }
        };
        
        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                const video = document.createElement('video');
                video.srcObject = stream;
                video.play();
                
                // Attempt QR scanning (would need html5-qrcode library in production)
                console.log('Camera initialized for QR scanning');
            })
            .catch(err => {
                console.log('Camera access denied. Manual entry available.');
            });
    } catch (error) {
        console.log('QR Scanner unavailable. Use manual entry.');
    }
}

// ==========================================
// FILE HANDLING
// ==========================================

function handleDragOver(e) {
    e.preventDefault();
    elements.mobileDropZone.classList.add('dragging');
}

function handleDragLeave(e) {
    e.preventDefault();
    elements.mobileDropZone.classList.remove('dragging');
}

function handleDrop(e) {
    e.preventDefault();
    elements.mobileDropZone.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
}

function handleFileSelect(e) {
    addFiles(e.target.files);
}

function addFiles(files) {
    for (const file of files) {
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            showToast(`${file.name} exceeds max size`, 'error');
            continue;
        }
        
        if (state.selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
            continue; // Skip duplicates
        }
        
        state.selectedFiles.push(file);
    }
    
    renderFileList();
    updateSendButtonState();
}

function renderFileList() {
    elements.mobileFileList.innerHTML = '';
    
    state.selectedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-icon">${getFileIcon(file.name)}</div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatBytes(file.size)}</div>
                </div>
            </div>
            <button class="file-remove" data-index="${index}">✕</button>
        `;
        
        fileItem.querySelector('.file-remove').addEventListener('click', () => {
            state.selectedFiles.splice(index, 1);
            renderFileList();
            updateSendButtonState();
        });
        
        elements.mobileFileList.appendChild(fileItem);
    });
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': '📄', 'doc': '📝', 'docx': '📝', 'xls': '📊', 'xlsx': '📊',
        'ppt': '🎬', 'pptx': '🎬', 'zip': '📦', 'rar': '📦',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
        'mp4': '🎥', 'avi': '🎥', 'mp3': '🎵', 'wav': '🎵', 'txt': '📑',
    };
    return icons[ext] || '📁';
}

function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function updateSendButtonState() {
    elements.mobileSendBtn.disabled = state.selectedFiles.length === 0 || !state.peerConnection;
}

function updateConnectButtonState() {
    const code = elements.roomCodeInput.value.toUpperCase().trim();
    elements.connectManualBtn.disabled = code.length !== 9;
}

// ==========================================
// CONNECTION
// ==========================================

async function connectToRoom() {
    const code = elements.roomCodeInput.value.toUpperCase().trim();
    
    if (!code || code.length !== 9) {
        showToast('Invalid room code', 'error');
        return;
    }
    
    try {
        state.roomCode = code;
        
        // Determine if this is for sending or receiving
        const isReceiver = await determineRole(code);
        state.isReceiver = isReceiver;
        
        createPeerConnection();
        
        if (isReceiver) {
            state.mode = 'receive';
            switchMode('receiveMode');
            
            // Request answer from signaling server
            const result = await sendToSignalingServer('/join-room', { roomCode: code });
            if (result.answer) {
                await state.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(result.answer)
                );
            }
        } else {
            state.mode = 'send';
            switchMode('sendMode');
            updateSendButtonState();
        }
        
        showToast('Connected to room!', 'success');
        
    } catch (error) {
        console.error('Connection error:', error);
        showToast('Failed to connect', 'error');
    }
}

async function determineRole(roomCode) {
    // In a real app, query the signaling server to see if room is waiting for receiver
    // For now, default to receiver mode
    return true;
}

function createPeerConnection() {
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    };
    
    state.peerConnection = new RTCPeerConnection(config);
    
    if (!state.isReceiver) {
        state.dataChannel = state.peerConnection.createDataChannel('fileshare', {
            ordered: true,
            maxPacketLifetime: 30000,
        });
        setupDataChannelHandlers(state.dataChannel);
    } else {
        state.peerConnection.addEventListener('datachannel', (event) => {
            state.dataChannel = event.channel;
            setupDataChannelHandlers(state.dataChannel);
        });
    }
    
    state.peerConnection.addEventListener('icecandidate', async (event) => {
        if (event.candidate) {
            await sendToSignalingServer('/ice', {
                roomCode: state.roomCode,
                candidate: event.candidate,
            });
        }
    });
    
    state.peerConnection.addEventListener('connectionstatechange', () => {
        console.log('Connection state:', state.peerConnection.connectionState);
    });
}

function setupDataChannelHandlers(channel) {
    channel.addEventListener('open', () => {
        console.log('Data channel opened');
        if (!state.isReceiver && state.selectedFiles.length > 0) {
            updateSendButtonState();
        }
    });
    
    channel.addEventListener('close', () => {
        console.log('Data channel closed');
    });
    
    channel.addEventListener('message', (event) => {
        handleDataChannelMessage(event);
    });
}

async function sendToSignalingServer(endpoint, data) {
    try {
        const response = await fetch(`${CONFIG.SIGNALING_SERVER}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error('Signaling error');
        return await response.json();
    } catch (error) {
        console.error('Signaling error:', error);
        throw error;
    }
}

// ==========================================
// FILE TRANSFER
// ==========================================

async function sendFilesViaPeer() {
    if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
        showToast('Not connected', 'error');
        return;
    }
    
    try {
        elements.mobileSendProgress.classList.remove('hidden');
        
        const fileList = state.selectedFiles.map(f => ({
            name: f.name,
            size: f.size,
            type: f.type,
        }));
        
        state.dataChannel.send(JSON.stringify({
            type: 'FILE_LIST',
            files: fileList,
        }));
        
        for (let i = 0; i < state.selectedFiles.length; i++) {
            await sendFile(state.selectedFiles[i], i);
        }
        
        state.dataChannel.send(JSON.stringify({ type: 'TRANSFER_COMPLETE' }));
        
        showToast('Files sent!', 'success');
        state.selectedFiles = [];
        renderFileList();
        elements.mobileSendProgress.classList.add('hidden');
        
    } catch (error) {
        console.error('Transfer error:', error);
        showToast('Transfer failed', 'error');
    }
}

async function sendFile(file, fileIndex) {
    const totalBytes = file.size;
    let sentBytes = 0;
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
        reader.onload = (event) => {
            const chunk = event.target.result;
            const chunkSize = CONFIG.CHUNK_SIZE;
            
            for (let offset = 0; offset < chunk.byteLength; offset += chunkSize) {
                const slice = chunk.slice(offset, offset + chunkSize);
                
                state.dataChannel.send(JSON.stringify({
                    type: 'FILE_CHUNK',
                    fileName: file.name,
                    chunkIndex: Math.floor(offset / chunkSize),
                    totalChunks: Math.ceil(chunk.byteLength / chunkSize),
                    data: Array.from(new Uint8Array(slice)),
                }));
                
                sentBytes += slice.byteLength;
                const progress = (sentBytes / totalBytes) * 100;
                elements.mobileSendFill.style.width = `${progress}%`;
                elements.mobileSendPercent.textContent = `${Math.round(progress)}%`;
            }
            
            resolve();
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// RECEIVE
// ==========================================

function handleDataChannelMessage(event) {
    try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
            case 'FILE_LIST':
                handleFileList(message.files);
                break;
            case 'FILE_CHUNK':
                handleFileChunk(message);
                break;
            case 'TRANSFER_COMPLETE':
                handleTransferComplete();
                break;
        }
    } catch (error) {
        console.error('Message error:', error);
    }
}

function handleFileList(files) {
    state.receivedData = files.map(f => ({
        ...f,
        chunks: [],
    }));
    
    elements.waitingSection.classList.add('hidden');
    elements.receiveProgressSection.classList.remove('hidden');
    renderReceivedList();
}

function handleFileChunk(message) {
    const file = state.receivedData.find(f => f.name === message.fileName);
    if (!file) return;
    
    file.chunks[message.chunkIndex] = new Uint8Array(message.data);
    
    const totalSize = file.size;
    const receivedSize = file.chunks.reduce((sum, chunk) => sum + (chunk ? chunk.length : 0), 0);
    const progress = (receivedSize / totalSize) * 100;
    
    elements.receiveFill.style.width = `${progress}%`;
    elements.receivePercent.textContent = `${Math.round(progress)}%`;
    elements.receiveFileName.textContent = message.fileName;
}

function handleTransferComplete() {
    elements.receiveProgressSection.classList.add('hidden');
    elements.mobileDownloadSection.classList.remove('hidden');
    renderReceivedList();
    showToast('Files ready to download!', 'success');
}

function renderReceivedList() {
    elements.mobileReceivedList.innerHTML = '';
    
    state.receivedData.forEach((file) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-icon">${getFileIcon(file.name)}</div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatBytes(file.size)}</div>
                </div>
            </div>
        `;
        elements.mobileReceivedList.appendChild(fileItem);
    });
}

async function downloadReceivedFiles() {
    for (const file of state.receivedData) {
        if (file.chunks.length === 0) continue;
        
        const totalSize = file.chunks.reduce((sum, chunk) => sum + (chunk ? chunk.length : 0), 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        
        for (const chunk of file.chunks.filter(Boolean)) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        
        const blob = new Blob([combined], { type: file.type || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    showToast('Downloads complete!', 'success');
}

// ==========================================
// DISCONNECT
// ==========================================

function disconnect() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    
    state.selectedFiles = [];
    state.receivedData = [];
    state.mode = 'manual';
    elements.roomCodeInput.value = '';
    
    switchToScanner();
    showToast('Disconnected', 'success');
}

// ==========================================
// UTILITIES
// ==========================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

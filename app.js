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
    qrStream: null,
    qrScanTimer: null,
    role: null,
    signalingPoller: null,
    remoteIceIndex: 0,
    hasRemoteDescription: false,
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
    const room = normalizeRoomCode(params.get('room'));
    
    if (room) {
        state.roomCode = room;
        elements.roomCodeInput.value = room;
        connectToRoom();
    }
}

// ==========================================
// MODE SWITCHING
// ==========================================

function switchToManual() {
    state.mode = 'manual';
    stopQRScanner();
    switchMode('manualMode');
    elements.roomCodeInput.focus();
}

function switchToScanner() {
    state.mode = 'scanner';
    switchMode('scannerMode');
    initializeQRScanner();
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
    if (!navigator.mediaDevices?.getUserMedia) {
        showToast('Camera scanner unavailable. Enter code manually.', 'error');
        return;
    }

    stopQRScanner();

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
            state.qrStream = stream;
            elements.qrScanner.innerHTML = '';

            const video = document.createElement('video');
            video.setAttribute('playsinline', 'true');
            video.muted = true;
            video.srcObject = stream;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            elements.qrScanner.appendChild(video);

            return video.play().then(() => scanQRCodeFromVideo(video));
        })
        .catch(() => {
            showToast('Camera permission needed. Enter code manually.', 'error');
        });
}

async function scanQRCodeFromVideo(video) {
    if (!('BarcodeDetector' in window)) {
        showToast('Live QR scanner not supported here. Enter code manually.', 'info');
        return;
    }

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    state.qrScanTimer = setInterval(async () => {
        try {
            const codes = await detector.detect(video);
            if (!codes.length) return;

            const rawValue = codes[0].rawValue || '';
            const roomCode = extractRoomCode(rawValue);
            if (!roomCode) {
                showToast('QR found, but room code is invalid', 'error');
                return;
            }

            stopQRScanner();
            state.roomCode = roomCode;
            elements.roomCodeInput.value = roomCode;
            showToast(`Room ${roomCode} scanned`, 'success');
            connectToRoom();
        } catch (error) {
            console.error('QR scan failed:', error);
        }
    }, 700);
}

function stopQRScanner() {
    if (state.qrScanTimer) {
        clearInterval(state.qrScanTimer);
        state.qrScanTimer = null;
    }

    if (state.qrStream) {
        state.qrStream.getTracks().forEach((track) => track.stop());
        state.qrStream = null;
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
    elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
    elements.connectManualBtn.disabled = elements.roomCodeInput.value.length !== 9;
}

// ==========================================
// CONNECTION
// ==========================================

async function connectToRoom() {
    const code = normalizeRoomCode(elements.roomCodeInput.value || state.roomCode);
    
    if (!code) {
        showToast('Invalid room code', 'error');
        return;
    }
    
    try {
        state.roomCode = code;
        elements.roomCodeInput.value = code;
        stopQRScanner();
        
        resetConnection();
        state.isReceiver = true;
        state.role = 'receiver';
        createPeerConnection('receiver');

        const result = await sendToSignalingServer('/join-room', { roomCode: code });
        if (!result.offer) {
            throw new Error('Room is waiting for sender offer');
        }

        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(result.offer));
        state.hasRemoteDescription = true;

        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        await sendToSignalingServer('/answer', { roomCode: code, answer });

        if (result.iceCandidates?.length) {
            for (const candidate of result.iceCandidates) {
                await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            state.remoteIceIndex = result.iceCandidates.length;
        }

        state.mode = 'receive';
        switchMode('receiveMode');
        startSignalingPolling('receiver');
        showToast('Connected to room!', 'success');
        
    } catch (error) {
        console.error('Connection error:', error);
        showToast(getFriendlyError(error, 'Failed to connect'), 'error');
    }
}

async function determineRole(roomCode) {
    // In a real app, query the signaling server to see if room is waiting for receiver
    // For now, default to receiver mode
    return true;
}

function createPeerConnection(role) {
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    };
    
    state.role = role;
    state.remoteIceIndex = 0;
    state.hasRemoteDescription = false;
    state.peerConnection = new RTCPeerConnection(config);
    
    if (role === 'sender') {
        state.dataChannel = state.peerConnection.createDataChannel('fileshare', {
            ordered: true,
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
            try {
                await sendToSignalingServer('/ice', {
                    roomCode: state.roomCode,
                    role: state.role,
                    candidate: event.candidate,
                });
            } catch (error) {
                console.error('ICE signaling failed:', error);
            }
        }
    });
    
    state.peerConnection.addEventListener('connectionstatechange', () => {
        console.log('Connection state:', state.peerConnection.connectionState);
        if (['failed', 'disconnected', 'closed'].includes(state.peerConnection.connectionState)) {
            showToast('Connection lost. Try reconnecting.', 'error');
        }
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
        showToast('Peer disconnected', 'error');
    });
    
    channel.addEventListener('message', (event) => {
        handleDataChannelMessage(event);
    });
}

async function sendToSignalingServer(endpoint, data) {
    try {
        const response = await fetch(`${CONFIG.SIGNALING_SERVER}/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Signaling error');
        return result;
    } catch (error) {
        console.error('Signaling error:', error);
        throw error;
    }
}

async function getRoomStatus(role = state.role) {
    const url = `${CONFIG.SIGNALING_SERVER}/api/room-status?code=${encodeURIComponent(state.roomCode)}&role=${role}&since=${state.remoteIceIndex}`;
    const response = await fetch(url);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Failed to fetch room status');
    return result;
}

function startSignalingPolling(role) {
    stopSignalingPolling();
    state.signalingPoller = setInterval(async () => {
        if (!state.peerConnection || !state.roomCode) return;

        try {
            const status = await getRoomStatus(role);
            if (status.iceCandidates?.length && state.peerConnection.remoteDescription) {
                for (const candidate of status.iceCandidates) {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
                state.remoteIceIndex = status.nextIceIndex || state.remoteIceIndex + status.iceCandidates.length;
            }
        } catch (error) {
            console.error('Signaling poll failed:', error);
            if (String(error.message).toLowerCase().includes('expired')) {
                stopSignalingPolling();
                showToast('Room expired. Scan or enter a new code.', 'error');
            }
        }
    }, 1500);
}

function stopSignalingPolling() {
    if (state.signalingPoller) {
        clearInterval(state.signalingPoller);
        state.signalingPoller = null;
    }
}

function resetConnection() {
    stopSignalingPolling();
    if (state.peerConnection) {
        state.peerConnection.close();
    }
    state.peerConnection = null;
    state.dataChannel = null;
    state.remoteIceIndex = 0;
    state.hasRemoteDescription = false;
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
        
        await sendJsonMessage({
            type: 'FILE_LIST',
            files: fileList,
        });
        
        for (let i = 0; i < state.selectedFiles.length; i++) {
            await sendFile(state.selectedFiles[i], i);
        }
        
        await sendJsonMessage({ type: 'TRANSFER_COMPLETE' });
        
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
        reader.onload = async (event) => {
            const chunk = event.target.result;
            const chunkSize = CONFIG.CHUNK_SIZE;
            
            try {
                for (let offset = 0; offset < chunk.byteLength; offset += chunkSize) {
                    const slice = chunk.slice(offset, offset + chunkSize);
                    
                    await sendJsonMessage({
                        type: 'FILE_CHUNK',
                        fileName: file.name,
                        chunkIndex: Math.floor(offset / chunkSize),
                        totalChunks: Math.ceil(chunk.byteLength / chunkSize),
                        data: Array.from(new Uint8Array(slice)),
                    });
                    
                    sentBytes += slice.byteLength;
                    const progress = (sentBytes / totalBytes) * 100;
                    elements.mobileSendFill.style.width = `${progress}%`;
                    elements.mobileSendPercent.textContent = `${Math.round(progress)}%`;
                }

                resolve();
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function sendJsonMessage(message) {
    if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
        throw new Error('Data channel not ready');
    }

    while (state.dataChannel.bufferedAmount > 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    state.dataChannel.send(JSON.stringify(message));
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
    resetConnection();
    stopQRScanner();
    
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

function normalizeRoomCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : '';
}

function extractRoomCode(value) {
    try {
        const url = new URL(value);
        const room = normalizeRoomCode(url.searchParams.get('room'));
        if (room) return room;
    } catch (_) {
        // Value may be just a room code.
    }

    return normalizeRoomCode(value);
}

function getFriendlyError(error, fallback) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('expired')) return 'Room expired. Ask sender for a new code.';
    if (message.includes('not found')) return 'Invalid room code or room not found.';
    if (message.includes('waiting')) return 'Room is not ready yet. Ask sender to start transfer.';
    if (message.includes('failed to fetch')) return 'Failed signaling connection. Check internet and try again.';
    return fallback;
}

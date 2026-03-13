(function() {
    // Inject CSS
    const css = `
    #faq-chatbot-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        font-family: 'Segoe UI', system-ui, sans-serif;
    }
    
    #faq-chatbot-btn {
        width: 65px;
        height: 65px;
        background: #2c3e90;
        color: white;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 32px;
        cursor: grab;
        box-shadow: 0 4px 14px rgba(0,0,0,0.3);
        user-select: none;
        transition: transform 0.2s, box-shadow 0.2s;
    }
    
    #faq-chatbot-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(0,0,0,0.4);
    }
    
    #faq-chatbot-btn:active {
        cursor: grabbing;
        transform: scale(0.95);
    }

    #faq-chatbot-window {
        width: 320px;
        height: 420px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        display: none;
        flex-direction: column;
        overflow: hidden;
        margin-bottom: 15px;
    }

    #faq-chatbot-header {
        background: #2c3e90;
        color: white;
        padding: 14px 16px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: grab;
        user-select: none;
        font-size: 15px;
    }

    #faq-chatbot-header:active {
        cursor: grabbing;
    }

    #faq-chatbot-close {
        cursor: pointer;
        background: none;
        border: none;
        color: white;
        font-size: 24px;
        line-height: 1;
        transition: opacity 0.2s;
    }
    
    #faq-chatbot-close:hover {
        opacity: 0.8;
    }

    #faq-chatbot-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        background: #f4f6f9;
        display: flex;
        flex-direction: column;
        gap: 12px;
        scroll-behavior: smooth;
    }

    .faq-msg {
        max-width: 85%;
        padding: 11px 15px;
        border-radius: 14px;
        font-size: 14px;
        line-height: 1.4;
        animation: chatFadeIn 0.3s ease;
    }

    @keyframes chatFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .faq-msg.bot {
        background: white;
        border: 1px solid #eaeaea;
        align-self: flex-start;
        border-bottom-left-radius: 4px;
        color: #333;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }

    .faq-msg.user {
        background: #2c3e90;
        color: white;
        align-self: flex-end;
        border-bottom-right-radius: 4px;
        box-shadow: 0 1px 2px rgba(23,43,77,0.2);
    }

    .faq-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        background: white;
        border-top: 1px solid #eee;
        max-height: 150px;
        overflow-y: auto;
    }

    .faq-option-btn {
        background: #fdfdfd;
        border: 1px solid #d1d5db;
        border-radius: 20px;
        padding: 9px 16px;
        cursor: pointer;
        font-size: 13px;
        color: #2c3e90;
        font-weight: 500;
        transition: all 0.2s;
        text-align: left;
    }

    .faq-option-btn:hover {
        background: #f0f4f8;
        border-color: #2c3e90;
    }
    
    .faq-typing {
        display: flex;
        gap: 4px;
        padding: 12px 16px;
        background: white;
        border-radius: 14px;
        border-bottom-left-radius: 4px;
        border: 1px solid #eaeaea;
        align-self: flex-start;
        width: fit-content;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    
    .faq-dot {
        width: 6px;
        height: 6px;
        background: #aaa;
        border-radius: 50%;
        animation: faqBounce 1.4s infinite ease-in-out both;
    }
    
    .faq-dot:nth-child(1) { animation-delay: -0.32s; }
    .faq-dot:nth-child(2) { animation-delay: -0.16s; }
    
    @keyframes faqBounce {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
    }
    `;

    const style = document.createElement('style');
    style.innerHTML = css;
    document.head.appendChild(style);

    // Inject HTML
    const container = document.createElement('div');
    container.id = 'faq-chatbot-container';
    container.innerHTML = `
        <div id="faq-chatbot-window">
            <div id="faq-chatbot-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:18px;">🤖</span>
                    <span>JanConnect Assistant</span>
                </div>
                <button id="faq-chatbot-close">&times;</button>
            </div>
            <div id="faq-chatbot-messages"></div>
            <div class="faq-options" id="faq-chatbot-options"></div>
        </div>
        <div id="faq-chatbot-btn" title="Chat with Assistant">🤖</div>
    `;
    document.body.appendChild(container);

    const btn = document.getElementById('faq-chatbot-btn');
    const win = document.getElementById('faq-chatbot-window');
    const closeBtn = document.getElementById('faq-chatbot-close');
    const header = document.getElementById('faq-chatbot-header');
    const messages = document.getElementById('faq-chatbot-messages');
    const optionsContainer = document.getElementById('faq-chatbot-options');

    // Dragging Logic
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startPosX = 0;
    let startPosY = 0;

    function onMouseDown(e) {
        if (e.target.tagName.toLowerCase() === 'button') return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        
        const rect = container.getBoundingClientRect();
        
        if (container.style.bottom) {
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            container.style.bottom = 'auto';
            container.style.right = 'auto';
            container.style.width = rect.width + 'px'; // Fix width for smooth drag
        }
        
        startPosX = container.offsetLeft;
        startPosY = container.offsetTop;
        e.preventDefault(); 
    }

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        
        let newLeft = startPosX + dx;
        let newTop = startPosY + dy;

        const rect = container.getBoundingClientRect();
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + rect.width > window.innerWidth) newLeft = window.innerWidth - rect.width;
        if (newTop + rect.height > window.innerHeight) newTop = window.innerHeight - rect.height;

        container.style.left = newLeft + 'px';
        container.style.top = newTop + 'px';
    }

    function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
    }

    btn.addEventListener('mousedown', onMouseDown);
    header.addEventListener('mousedown', onMouseDown);
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Chatbot functionality
    let isOpen = false;
    let hasStarted = false;
    
    // Prevent click from triggering if dragged
    btn.addEventListener('click', (e) => {
        if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) return;
        win.style.display = 'flex';
        btn.style.display = 'none';
        isOpen = true;
        
        if (!hasStarted) {
            startChat();
            hasStarted = true;
        }
    });

    closeBtn.addEventListener('click', () => {
        win.style.display = 'none';
        btn.style.display = 'flex';
        isOpen = false;
    });

    function addMessage(text, type) {
        const div = document.createElement('div');
        div.className = 'faq-msg ' + type;
        div.innerHTML = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }
    
    function showTyping() {
        optionsContainer.style.display = 'none';
        const div = document.createElement('div');
        div.className = 'faq-typing';
        div.id = 'faq-typing-indicator';
        div.innerHTML = '<div class="faq-dot"></div><div class="faq-dot"></div><div class="faq-dot"></div>';
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }
    
    function hideTyping() {
        const indicator = document.getElementById('faq-typing-indicator');
        if (indicator) indicator.remove();
    }

    function showOptions(options) {
        optionsContainer.innerHTML = '';
        if (options.length === 0) {
            optionsContainer.style.display = 'none';
            return;
        }
        optionsContainer.style.display = 'flex';
        
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'faq-option-btn';
            btn.innerHTML = opt.text;
            btn.onclick = () => {
                addMessage(opt.text, 'user');
                showTyping();
                setTimeout(() => {
                    hideTyping();
                    opt.action();
                }, 800);
            };
            optionsContainer.appendChild(btn);
        });
        messages.scrollTop = messages.scrollHeight;
    }

    const chatFlow = {
        start: () => {
            addMessage('Hello! I am the JanConnect Assistant. How can I help you today?', 'bot');
            showOptions([
                { text: 'How do I file a complaint?', action: chatFlow.fileComplaint },
                { text: 'How can I check my complaint status?', action: chatFlow.checkStatus },
                { text: 'What are the SLA resolution times?', action: chatFlow.slaTimes },
                { text: 'What is the Re-appeal Process?', action: chatFlow.reappealInfo },
                { text: 'I need to talk to a human.', action: chatFlow.human }
            ]);
        },
        fileComplaint: () => {
            addMessage('To file a complaint:<br>1. Log into your dashboard.<br>2. Fill out the "File a Complaint" form.<br>3. Provide Category, Ward, Title, Description, and Address.<br>4. Attach an image or video evidence (up to 40MB).', 'bot');
            chatFlow.backToMain();
        },
        checkStatus: () => {
            addMessage('You can view your complaint status directly on your Dashboard. Complaints can be Pending, In Progress, Escalated, Resolved, or Closed.', 'bot');
            chatFlow.backToMain();
        },
        slaTimes: () => {
            addMessage('SLA (Service Level Agreement) deadlines determine how quickly a department must act:<br>• 🛣️ Roads: 48 hours<br>• 💧 Water: 24 hours<br>• ⚡ Electricity: 12 hours<br>• 🧹 Sanitation: 24 hours<br>• 🚨 Safety: 6 hours', 'bot');
            chatFlow.backToMain();
        },
        reappealInfo: () => {
            addMessage('If your complaint was marked "Resolved" but you are not satisfied, you can click "📋 Appeal" next to it. You will be asked for a reason and can upload fresh photo/video evidence to reopen it!', 'bot');
            chatFlow.backToMain();
        },
        human: () => {
            addMessage('I am currently an automated helper! To get humam assistance, please file a specific complaint so an officer is assigned. For extreme emergencies, dial 100 or your local emergency hotline immediately.', 'bot');
            chatFlow.backToMain();
        },
        backToMain: () => {
            setTimeout(() => {
                addMessage('Is there anything else I can help with?', 'bot');
                showOptions([
                    { text: 'Yes, show the main menu again.', action: chatFlow.start },
                    { text: 'No, thank you.', action: () => {
                        addMessage('You are very welcome! Have a great day ahead.', 'bot');
                        showOptions([{ text: 'Start over', action: chatFlow.start }]);
                    }}
                ]);
            }, 600);
        }
    };

    function startChat() {
        showTyping();
        setTimeout(() => {
            hideTyping();
            chatFlow.start();
        }, 1000);
    }

})();

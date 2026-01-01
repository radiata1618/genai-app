// Check if sidebar is already executed on this page
if (!window.genaiExtensionLoaded) {
    window.genaiExtensionLoaded = true;

    chrome.storage.local.get(['apiUrl', 'apiKey', 'rules'], (settings) => {
        const rules = settings.rules || [];
        const currentUrl = window.location.href;

        // Find a matching rule
        const matchedRule = rules.find(rule => {
            try {
                const regex = new RegExp(rule.domainRegex);
                return regex.test(currentUrl);
            } catch (e) {
                console.error('Invalid regex:', rule.domainRegex, e);
                return false;
            }
        });

        if (matchedRule) {
            console.log('GenAI Summarizer: URL Matched rule:', matchedRule);
            initSidebar(matchedRule, settings);
        }
    });

    function initSidebar(rule, settings) {
        // 1. Create Host Element
        const host = document.createElement('div');
        host.id = 'genai-sidebar-host';
        document.body.appendChild(host);

        // 2. Attach Shadow DOM
        const shadow = host.attachShadow({ mode: 'open' });

        // 3. Inject CSS
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('styles.css');
        shadow.appendChild(styleLink);

        // 4. Create structure
        const sidebar = document.createElement('div');
        sidebar.className = 'genai-sidebar';
        sidebar.innerHTML = `
      <div class="genai-header">
        <span class="genai-title">AI Summary</span>
        <button class="genai-close-btn">&times;</button>
      </div>
      <div class="genai-content">
        <div class="genai-loading">Generating Summary...</div>
      </div>
      <div class="genai-footer">
        <textarea class="genai-chat-input" placeholder="Ask a follow-up question..." rows="1"></textarea>
        <button class="genai-send-btn">Send</button>
      </div>
    `;
        shadow.appendChild(sidebar);

        // 5. Open Sidebar
        requestAnimationFrame(() => {
            sidebar.classList.add('open');

            // Adjust both html and body to ensure content shifts
            const shiftAmount = '350px';

            document.documentElement.style.transition = 'margin-right 0.3s ease-in-out';
            document.documentElement.style.marginRight = shiftAmount;

            document.body.style.transition = 'margin-right 0.3s ease-in-out';
            document.body.style.marginRight = shiftAmount;
        });

        // Close handler
        sidebar.querySelector('.genai-close-btn').addEventListener('click', () => {
            sidebar.classList.remove('open');

            // Reset styles
            document.documentElement.style.marginRight = '';
            document.body.style.marginRight = '';

            // Cleanup transitions after animation
            setTimeout(() => {
                document.documentElement.style.transition = '';
                document.body.style.transition = '';
                host.remove();
            }, 300);
        });

        // Chat Elements
        const contentContainer = sidebar.querySelector('.genai-content');
        const input = sidebar.querySelector('.genai-chat-input');
        const sendBtn = sidebar.querySelector('.genai-send-btn');

        // Context Management
        const pageContent = document.body.innerText.substring(0, 50000); // Limit content
        let conversationHistory = []; // Array of {role: 'user'|'model', text: '...'}

        // 6. Initial Summary
        generateInitialSummary(rule, settings, pageContent, contentContainer, conversationHistory);

        // 7. Chat Event Listeners
        const handleSend = async () => {
            const question = input.value.trim();
            if (!question) return;

            // Display User Message
            const userMsgEl = appendMessage(contentContainer, 'user', question);
            input.value = '';
            input.style.height = 'auto'; // Reset height

            // Scroll to show the user's question immediately
            userMsgEl.scrollIntoView({ behavior: 'smooth', block: 'end' });

            // Disable input during generation
            input.disabled = true;
            sendBtn.disabled = true;

            // Send to API
            await processChat(rule, settings, pageContent, question, conversationHistory, contentContainer, userMsgEl);

            // Re-enable
            input.disabled = false;
            sendBtn.disabled = false;
            input.focus();
        };

        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keydown', (e) => {
            // Enter to send, Shift+Enter for new line
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Auto-resize textarea
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }

    // Helper: Append formatted message to UI
    function appendMessage(container, role, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `genai-message ${role}`;

        let label = role === 'user' ? 'You' : 'AI';

        // Render Markdown for AI, Plain text for User (safe)
        let contentHtml = role === 'user'
            ? text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
            : marked.parse(text);

        msgDiv.innerHTML = `
            <div class="genai-message-label">${label}</div>
            <div class="genai-message-body">${contentHtml}</div>
        `;
        container.appendChild(msgDiv);

        return msgDiv;
    }

    async function generateInitialSummary(rule, settings, pageContent, contentContainer, conversationHistory) {
        const prompt = `${rule.systemPrompt}\n\nContent:\n${pageContent}`;

        // Use default URL if not set
        const apiUrl = settings.apiUrl || "https://genai-app-backend-yg7yzstuza-uc.a.run.app/api/generate_genai";
        const apiKey = settings.apiKey || "";

        try {
            const data = await callApi(apiUrl, apiKey, prompt);

            // Clear loading
            contentContainer.innerHTML = '';

            const answer = data.answer || "No response received.";

            // Add to history
            conversationHistory.push({ role: 'user', text: prompt }); // Conceptually the initial prompt
            conversationHistory.push({ role: 'model', text: answer });

            // Display AI Response as first message
            appendMessage(contentContainer, 'ai', answer);

            // Scroll to top for initial summary
            contentContainer.scrollTop = 0;

        } catch (error) {
            console.error('GenAI API Error:', error);
            contentContainer.innerHTML = `<div class="genai-error">Error: ${error.message}. Please check your API settings.</div>`;
        }
    }

    async function processChat(rule, settings, pageContent, question, conversationHistory, contentContainer, userMsgEl) {
        const apiUrl = settings.apiUrl || "https://genai-app-backend-yg7yzstuza-uc.a.run.app/api/generate_genai";
        const apiKey = settings.apiKey || "";

        // Construct context-aware prompt
        // Since backend is stateless, we re-send relevant context.
        // Strategy: "Here is the content. History: User asked X, AI said Y. Now User asks Z."

        let contextText = `Original Content:\n${pageContent}\n\n`;

        // Add conversation history (simplified for text prompt)
        // Skip the very first bulky system prompt in history to avoid duplication, assume 'Original Content' covers it.
        // We start loop from 1 (skipping initial prompt) if we want, or just format purely.

        // Let's format history:
        let historyText = "Conversation History:\n";
        // Skip index 0 (the huge initial prompt) to save tokens/confusion, just assume Content is the base.
        // Start from index 1 (AI summary)
        if (conversationHistory.length > 1) {
            for (let i = 1; i < conversationHistory.length; i++) {
                const msg = conversationHistory[i];
                historyText += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.text}\n`;
            }
        }

        const fullPrompt = `${rule.systemPrompt}\n\n${contextText}\n${historyText}\nUser: ${question}\nAI:`;

        try {
            const data = await callApi(apiUrl, apiKey, fullPrompt);
            const answer = data.answer || "No response.";

            // Add new turn to history
            conversationHistory.push({ role: 'user', text: question });
            conversationHistory.push({ role: 'model', text: answer });

            appendMessage(contentContainer, 'ai', answer);

            // Scroll logic: User requested to align User Question to top of view
            // Use setTimeout to allow DOM/layout to update
            if (userMsgEl) {
                setTimeout(() => {
                    userMsgEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }

        } catch (error) {
            console.error('Chat Error:', error);
            const errDiv = document.createElement('div');
            errDiv.className = 'genai-error';
            errDiv.innerText = `Error: ${error.message}`;
            contentContainer.appendChild(errDiv);
        }
    }

    async function callApi(url, key, query) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-INTERNAL-API-KEY': key
            },
            body: JSON.stringify({ query: query })
        });
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        return response.json();
    }
}

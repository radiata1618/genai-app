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
    `;
        shadow.appendChild(sidebar);

        // 5. Open Sidebar
        requestAnimationFrame(() => {
            sidebar.classList.add('open');
            document.body.style.transition = 'margin-right 0.3s ease-in-out';
            document.body.style.marginRight = '350px'; // Shift body content
        });

        // Close handler
        sidebar.querySelector('.genai-close-btn').addEventListener('click', () => {
            sidebar.classList.remove('open');
            document.body.style.marginRight = '0px'; // Reset body content
            // Optional: remove host after animation
            setTimeout(() => {
                host.remove();
                document.body.style.transition = ''; // Clean up transition
            }, 300);
        });

        // 6. Extract Content & Call API
        generateSummary(rule, settings, sidebar.querySelector('.genai-content'));
    }

    async function generateSummary(rule, settings, contentContainer) {
        const pageContent = document.body.innerText;
        // Limit content length to prevent token overflow if needed, e.g. 50k chars
        const limitedContent = pageContent.substring(0, 50000);

        const prompt = `${rule.systemPrompt}\n\nContent:\n${limitedContent}`;

        // Use default URL if not set
        const apiUrl = settings.apiUrl || "https://genai-app-backend-yg7yzstuza-uc.a.run.app/api/generate_genai";
        const apiKey = settings.apiKey || "";

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-INTERNAL-API-KEY': apiKey
                },
                body: JSON.stringify({
                    query: prompt
                })
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const answer = data.answer || "No response received.";

            // Convert Markdown to HTML using marked.js
            // marked is available globally because we included it in manifest.json
            contentContainer.innerHTML = `<div class="genai-summary">${marked.parse(answer)}</div>`;

        } catch (error) {
            console.error('GenAI API Error:', error);
            contentContainer.innerHTML = `<div class="genai-error">Error: ${error.message}. Please check your API settings.</div>`;
        }
    }
}

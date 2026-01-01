// Default API URL
const DEFAULT_API_URL = "https://genai-app-backend-yg7yzstuza-uc.a.run.app/api/generate_genai";

// Saves options to chrome.storage
const saveOptions = () => {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;

    const rules = [];
    document.querySelectorAll('.rule-container').forEach(container => {
        const domainRegex = container.querySelector('.domain-regex').value;
        const systemPrompt = container.querySelector('.system-prompt').value;
        if (domainRegex && systemPrompt) {
            rules.push({ domainRegex, systemPrompt });
        }
    });

    chrome.storage.local.set(
        { apiUrl, apiKey, rules },
        () => {
            // Update status to let user know options were saved.
            const status = document.getElementById('status');
            status.style.display = 'block';
            setTimeout(() => {
                status.style.display = 'none';
            }, 2000);
        }
    );
};

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
const restoreOptions = () => {
    chrome.storage.local.get(
        { apiUrl: DEFAULT_API_URL, apiKey: '', rules: [] },
        (items) => {
            document.getElementById('apiUrl').value = items.apiUrl;
            document.getElementById('apiKey').value = items.apiKey;

            const rulesList = document.getElementById('rulesList');
            rulesList.innerHTML = ''; // Clear current
            items.rules.forEach(rule => addRuleElement(rule.domainRegex, rule.systemPrompt));
        }
    );
};

const addRuleElement = (domainRegex = '', systemPrompt = '') => {
    const rulesList = document.getElementById('rulesList');
    const div = document.createElement('div');
    div.className = 'rule-container';
    div.innerHTML = `
    <div class="form-group">
      <label>Domain Regex (e.g., .*wikipedia\\.org.*)</label>
      <input type="text" class="domain-regex" value="${domainRegex}">
    </div>
    <div class="form-group">
      <label>System Prompt / Question</label>
      <input type="text" class="system-prompt" value="${systemPrompt}" placeholder="e.g. Summarize this page in 3 bullet points.">
    </div>
    <button class="delete">Delete Rule</button>
  `;

    div.querySelector('.delete').addEventListener('click', () => {
        rulesList.removeChild(div);
    });

    rulesList.appendChild(div);
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
document.getElementById('addRule').addEventListener('click', () => addRuleElement());

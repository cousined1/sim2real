(function() {
    // Check if consent has already been given
    if (localStorage.getItem('cookieConsentGiven')) {
        return;
    }

    // Create the banner element
    const banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.style.position = 'fixed';
    banner.style.bottom = '0';
    banner.style.left = '0';
    banner.style.width = '100%';
    banner.style.backgroundColor = 'var(--surface-color, #ffffff)';
    banner.style.color = 'var(--text-color, #1a1a1a)';
    banner.style.padding = '1.5rem';
    banner.style.boxShadow = '0 -4px 12px rgba(0, 0, 0, 0.1)';
    banner.style.zIndex = '9999';
    banner.style.display = 'flex';
    banner.style.flexDirection = 'column';
    banner.style.alignItems = 'center';
    banner.style.justifyContent = 'space-between';
    banner.style.gap = '1rem';
    
    // Add media query for responsiveness
    const mq = window.matchMedia('(min-width: 768px)');
    if (mq.matches) {
        banner.style.flexDirection = 'row';
    }
    
    mq.addEventListener('change', (e) => {
        if (e.matches) {
            banner.style.flexDirection = 'row';
        } else {
            banner.style.flexDirection = 'column';
        }
    });

    const content = document.createElement('div');
    content.innerHTML = `
        <h3 style="margin-top: 0; font-size: 1.125rem; margin-bottom: 0.5rem;">We value your privacy</h3>
        <p style="margin: 0; font-size: 0.875rem; max-width: 800px;">
            We use cookies to enhance your browsing experience, serve personalized ads or content, and analyze our traffic. 
            By clicking "Accept All", you consent to our use of cookies.
        </p>
    `;

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.gap = '1rem';
    buttonGroup.style.alignItems = 'center';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept All';
    acceptBtn.className = 'btn btn--primary';
    acceptBtn.style.padding = '0.5rem 1rem';
    acceptBtn.style.cursor = 'pointer';
    acceptBtn.style.whiteSpace = 'nowrap';

    const declineBtn = document.createElement('button');
    declineBtn.textContent = 'Essential Only';
    declineBtn.className = 'btn btn--ghost';
    declineBtn.style.padding = '0.5rem 1rem';
    declineBtn.style.cursor = 'pointer';
    declineBtn.style.whiteSpace = 'nowrap';

    buttonGroup.appendChild(declineBtn);
    buttonGroup.appendChild(acceptBtn);

    banner.appendChild(content);
    banner.appendChild(buttonGroup);

    document.body.appendChild(banner);

    // Handle Accept All
    acceptBtn.addEventListener('click', function() {
        localStorage.setItem('cookieConsentGiven', 'true');
        localStorage.setItem('cookieConsentPreferences', JSON.stringify({
            analytics: true,
            marketing: true
        }));
        
        // Update Google Consent Mode
        if (typeof gtag === 'function') {
            gtag('consent', 'update', {
                'ad_storage': 'granted',
                'analytics_storage': 'granted'
            });
        }
        
        banner.style.display = 'none';
    });

    // Handle Essential Only
    declineBtn.addEventListener('click', function() {
        localStorage.setItem('cookieConsentGiven', 'true');
        localStorage.setItem('cookieConsentPreferences', JSON.stringify({
            analytics: false,
            marketing: false
        }));
        
        // Google Consent Mode remains denied
        
        banner.style.display = 'none';
    });
})();

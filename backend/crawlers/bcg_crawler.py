import time
from .base_crawler import BaseCrawler

class BCGCrawler(BaseCrawler):
    BASE_URL_EN = "https://www.bcg.com/featured-insights"
    BASE_URL_JP = "https://www.bcg.com/ja-jp/featured-insights"

    def _perform_crawl(self, page, limit, locale):
        base_url = self.BASE_URL_JP if locale == "jp" else self.BASE_URL_EN
        self.log_func(f"Navigating to {base_url}...")
        page.goto(base_url, timeout=60000, wait_until="domcontentloaded")
        
        results = []
        
        # BCG often has a clean list but again, "Load more" or pagination.
        # Strategy: Similar to McKinsey, find article links first.
        
        # Scroll
        for _ in range(3):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)
            
        # Get Article Links
        # BCG links often contain "/publications/" or "/featured-insights/"
        article_links = set()
        links = page.query_selector_all("a[href*='/publications/'], a[href*='/featured-insights/']")
        
        for l in links:
            href = l.get_attribute("href")
            if href:
                if href.startswith("/"):
                    href = "https://www.bcg.com" + href
                # Filter out non-article pages if possible
                article_links.add(href)
                
        self.log_func(f"Found {len(article_links)} potential article links. Checking for PDFs...")
        
        count = 0
        for link in article_links:
            if count >= limit: break
            
            try:
                self.log_func(f"Checking article: {link}")
                page.goto(link, timeout=30000)
                
                # BCG PDF links usually say "Download PDF"
                # Selector: a[href$='.pdf']
                
                pdf_link = None
                pdfs = page.query_selector_all("a[href$='.pdf']")
                for p_elem in pdfs:
                    phref = p_elem.get_attribute("href")
                    if phref:
                        if phref.startswith("/"):
                            phref = "https://www.bcg.com" + phref
                        pdf_link = phref
                        break
                
                if pdf_link:
                    title = page.title()
                    results.append({'title': title, 'url': pdf_link, 'date': ''})
                    self.log_func(f"  -> Found PDF: {title}")
                    count += 1
            except Exception as e:
                self.log_func(f"  -> Failed: {e}")
                
        return results

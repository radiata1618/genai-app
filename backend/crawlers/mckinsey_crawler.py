import time
from .base_crawler import BaseCrawler

class McKinseyCrawler(BaseCrawler):
    BASE_URL = "https://www.mckinsey.com/featured-insights"

    def _perform_crawl(self, page, limit):
        self.log_func(f"Navigating to {self.BASE_URL}...")
        page.goto(self.BASE_URL, timeout=60000)
        
        # McKinsey's featured insights page uses "Load more" or infinite scroll often.
        # But actually, they have a search/archive page. 
        # For simplicity, let's try to scrape the main insights list and click 'Load More'
        
        results = []
        
        # Click "Load more" button if it exists repeatedly
        # Selector for Load More might vary. Let's try to just scroll and find article links first for MVP.
        # A better approach for McKinsey is to use their search page with empty query to get everything?
        # Or finding the "All Insights" link.
        
        # Let's try scrolling a bit to trigger lazy loading
        for _ in range(3):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)
        
        # Extract links
        # McKinsey structure: <a> href ending in .pdf is rare directly on listing. 
        # Usually links to article page -> article page has "Download PDF".
        # This is TRICKY. 
        # Strategy: Get Article URLs -> Visit each -> Find PDF.
        # This is slow but complete.
        
        # 1. Get Article Links
        article_links = set()
        # Common selector for McKinsey article cards
        # Look for links containing "/featured-insights/"
        links = page.query_selector_all("a[href*='/featured-insights/']")
        for l in links:
            href = l.get_attribute("href")
            if href:
                if href.startswith("/"):
                    href = "https://www.mckinsey.com" + href
                article_links.add(href)
        
        self.log_func(f"Found {len(article_links)} potential article links. Checking for PDFs...")
        
        count = 0
        for link in article_links:
            if count >= limit: break
            
            try:
                self.log_func(f"Checking article: {link}")
                page.goto(link, timeout=30000)
                
                # Check for "Download" button or PDF link
                # McKinsey often puts PDF in a specific floating action button or header
                # Selector: a[href$='.pdf']
                
                pdf_link = None
                pdfs = page.query_selector_all("a[href$='.pdf']")
                for p_elem in pdfs:
                    phref = p_elem.get_attribute("href")
                    if phref:
                        if phref.startswith("/"):
                            phref = "https://www.mckinsey.com" + phref
                        pdf_link = phref
                        break # Take first PDF found
                
                if pdf_link:
                    title = page.title()
                    results.append({'title': title, 'url': pdf_link, 'date': ''})
                    self.log_func(f"  -> Found PDF: {title}")
                    count += 1
                else:
                    self.log_func("  -> No PDF found.")
            except Exception as e:
                self.log_func(f"  -> Failed to list page: {e}")
                
        return results

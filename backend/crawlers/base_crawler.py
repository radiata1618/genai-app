from abc import ABC, abstractmethod
from playwright.sync_api import sync_playwright

class BaseCrawler(ABC):
    def __init__(self, log_func=print):
        self.log_func = log_func

    def crawl(self, limit=100, locale="en"):
        """
        Crawls the site and returns a list of PDF URLs.
        :param limit: Max number of PDFs to find.
        :param locale: 'en' for Global, 'jp' for Japan.
        :return: List of dicts {'title': str, 'url': str, 'date': str}
        """
        self.log_func(f"Starting crawl for {self.__class__.__name__} [{locale}]...")
        results = []
        
        with sync_playwright() as p:
            # Launch browser
            # Use channel="chrome" to mimic real browser better and avoid WAF blocks
            browser = p.chromium.launch(headless=True, channel="chrome") 
            try:
                # Use a standard User-Agent to avoid some anti-bot protections/protocol errors
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )
                page = context.new_page()
                results = self._perform_crawl(page, limit, locale)
            except Exception as e:
                self.log_func(f"Error during crawl: {e}")
            finally:
                browser.close()
                
        self.log_func(f"Crawl finished. Found {len(results)} PDFs.")
        return results

    @abstractmethod
    def _perform_crawl(self, page, limit, locale):
        """
        Implementation specific crawling logic.
        """
        pass

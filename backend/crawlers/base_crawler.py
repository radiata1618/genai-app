from abc import ABC, abstractmethod
from playwright.sync_api import sync_playwright

class BaseCrawler(ABC):
    def __init__(self, log_func=print):
        self.log_func = log_func

    def crawl(self, limit=100):
        """
        Crawls the site and returns a list of PDF URLs.
        :param limit: Max number of PDFs to find.
        :return: List of dicts {'title': str, 'url': str, 'date': str}
        """
        self.log_func(f"Starting crawl for {self.__class__.__name__}...")
        results = []
        
        with sync_playwright() as p:
            # Launch browser
            browser = p.chromium.launch(headless=True) # Headless mode
            try:
                page = browser.new_page()
                results = self._perform_crawl(page, limit)
            except Exception as e:
                self.log_func(f"Error during crawl: {e}")
            finally:
                browser.close()
                
        self.log_func(f"Crawl finished. Found {len(results)} PDFs.")
        return results

    @abstractmethod
    def _perform_crawl(self, page, limit):
        """
        Implementation specific crawling logic.
        """
        pass

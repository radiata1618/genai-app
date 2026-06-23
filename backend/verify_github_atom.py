import urllib.request
import xml.etree.ElementTree as ET

def test_github_atom(username):
    url = f"https://github.com/{username}.atom"
    print(f"\nFetching public feed for {username}: {url}")
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
        root = ET.fromstring(xml_data)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        entries = root.findall('atom:entry', ns)
        print(f"Found {len(entries)} entries")
        for entry in entries[:3]:
            title = entry.find('atom:title', ns).text
            link = entry.find('atom:link', ns).attrib.get('href')
            print(f"- Title: {title}")
            print(f"  Link: {link}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_github_atom("chiphuyen")
    test_github_atom("seattle-data-guy")

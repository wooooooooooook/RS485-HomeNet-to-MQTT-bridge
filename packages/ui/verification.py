from playwright.sync_api import sync_playwright, expect
import time

def verify_language_setting():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Mock API responses
        # Initial load: no locale set
        page.route("**/api/frontend-settings", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"settings": {"toast": {"stateChange": false, "command": true}}}'
        ))

        page.route("**/api/bridge/info", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"bridges": [], "mqttUrl": "ws://localhost:1883", "status": "started", "topic": "test"}'
        ))
        page.route("**/api/activity/recent", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='[]'
        ))
        page.route("**/api/log-sharing/status", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"asked": true, "consented": false}'
        ))
        page.route("**/api/commands", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"commands": []}'
        ))

        print("Navigating to app...")
        page.goto("http://localhost:5173/")

        # Wait for loading to finish
        try:
            expect(page.get_by_text("Loading resources...")).not_to_be_visible(timeout=10000)
        except:
            pass

        print("Navigating to Settings...")

        # Click the settings button in sidebar
        buttons = page.get_by_role("button").all()
        for i, btn in enumerate(buttons):
            try:
                txt = btn.text_content()
                if "설정" in txt or "Settings" in txt:
                    btn.click()
                    break
            except:
                pass

        # Wait a moment for view transition
        time.sleep(1)

        # Look for the language dropdown
        select = page.locator(".lang-switcher select")
        if select.count() > 0:
            print("Found language switcher!")

            # Setup route to intercept the PUT request
            def handle_put(route):
                print(f"PUT request received: {route.request.post_data}")
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"settings": {"toast": {"stateChange": false, "command": true}, "locale": "en"}}'
                )

            page.unroute("**/api/frontend-settings")
            page.route("**/api/frontend-settings", handle_put)

            # Change language
            print("Changing language to English...")
            select.select_option("en")

            # Wait for update
            time.sleep(2)
            page.screenshot(path="verification/final_english_settings.png")

            # Use specific locator to avoid strict mode violation
            # Check for the Heading "Settings"
            heading = page.get_by_role("heading", name="Settings")
            if heading.is_visible():
                print("Verification SUCCESS: 'Settings' heading found.")
            else:
                print("Verification FAILED: 'Settings' heading not found.")

        else:
            print("Language switcher not found.")

if __name__ == "__main__":
    verify_language_setting()

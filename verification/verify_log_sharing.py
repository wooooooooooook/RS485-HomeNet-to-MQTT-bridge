
import asyncio
from playwright.async_api import async_playwright, expect

async def verify_frontend():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            await page.goto("http://localhost:5173", timeout=10000)
            await page.wait_for_load_state("networkidle")

            # If modal is blocking, we should see it.
            # "로그 및 데이터 공유 동의" title
            if await page.get_by_text("로그 및 데이터 공유 동의").is_visible():
                print("Modal is visible. Taking screenshot...")
                await page.screenshot(path="verification/consent_modal.png")

                # Click agree to proceed
                await page.get_by_role("button", name="동의 및 활성화").click()
                print("Clicked Agree.")
                await asyncio.sleep(1) # Wait for modal to close

            # Now navigate to Settings
            await page.get_by_role("button", name="설정").click()

            # Wait for Settings view
            await expect(page.get_by_text("로그 및 데이터 공유")).to_be_visible()

            # Take screenshot of settings
            await page.screenshot(path="verification/settings_page.png")
            print("Settings page screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")
            await page.screenshot(path="verification/error.png")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_frontend())

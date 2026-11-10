"""Browser-level regression: public links must be real, hoverable and clickable.

Runs Chrome against a local Vite server using synthetic public CI settings.
The test checks actual browser elementFromPoint hit testing and native route
navigation. React DOM unit tests alone cannot detect transparent overlays.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

BASE = "http://127.0.0.1:3000"
BREAKPOINTS = [(1440, 900), (1024, 768), (768, 900), (390, 844)]


def wait_for_server(timeout: int = 55) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(BASE, timeout=2) as response:
                if response.status == 200:
                    return
        except (URLError, OSError):
            time.sleep(.35)
    raise AssertionError("Vite server failed to serve the landing page")


def wait_for_landing(driver):
    WebDriverWait(driver, 20).until(
        lambda d: len(d.find_elements(By.CSS_SELECTOR, ".vgn-hero h1")) > 0
    )


def navigate_home(driver):
    driver.get(BASE + "/")
    wait_for_landing(driver)


def check_click_target(driver, selector: str, destination: str, *, scrolled=False):
    navigate_home(driver)
    if scrolled:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight * .55)")
        time.sleep(.1)
    width = driver.execute_script("return innerWidth")
    # Only header route links collapse into the responsive menu. Closing CTA
    # links remain in their own section and must be independently hit-tested.
    if width <= 1020 and (not selector or ".vgn-nav-actions" in selector):
        menu = driver.find_element(By.CSS_SELECTOR, ".vgn-menu-button")
        menu.click()
        selector = ".vgn-mobile-navigation a[href='%s']" % destination

    target = driver.find_element(By.CSS_SELECTOR, selector)
    # Center target without a scroll that would hide sticky header buttons.
    target_is_header = ".vgn-nav-actions" in selector or ".vgn-mobile-navigation" in selector
    if not target_is_header:
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'center',behavior:'instant'})",
            target,
        )

    is_hit_and_pointer = driver.execute_script(
        """const el=arguments[0], rect=el.getBoundingClientRect();
           const centerX=rect.left+rect.width/2, centerY=rect.top+rect.height/2;
           const hit=document.elementFromPoint(centerX,centerY);
           return {
             target: el.tagName,
             href: el.getAttribute('href'),
             cursor: getComputedStyle(el).cursor,
             visible: rect.width>0 && rect.height>0 &&
               centerX>=0 && centerX<innerWidth &&
               centerY>=0 && centerY<innerHeight,
             hit: !!hit && (hit===el || el.contains(hit)),
             blockingElement: hit?.tagName+' '+(hit?.className?.baseVal ?? hit?.className ?? ''),
           };""",
        target,
    )
    assert is_hit_and_pointer["target"] == "A", is_hit_and_pointer
    assert is_hit_and_pointer["href"] == destination, is_hit_and_pointer
    assert is_hit_and_pointer["visible"], (selector, is_hit_and_pointer)
    assert is_hit_and_pointer["hit"], (
        "Link is covered by a different DOM element:", selector, is_hit_and_pointer
    )
    assert is_hit_and_pointer["cursor"] == "pointer", (
        "Pointer cursor missing:", selector, is_hit_and_pointer
    )
    target.click()  # Chrome raises ElementClickInterceptedException on real overlays.
    WebDriverWait(driver, 15).until(
        lambda d: urlparse(d.current_url).path == destination
    )
    WebDriverWait(driver, 15).until(
        lambda d: len(d.find_elements(By.CSS_SELECTOR, ".vg-auth-form")) > 0
    )


def check_anchor_scroll(driver):
    navigate_home(driver)
    width = driver.execute_script("return innerWidth")
    if width <= 1020:
        driver.find_element(By.CSS_SELECTOR, ".vgn-menu-button").click()
        anchor = driver.find_element(By.CSS_SELECTOR, '.vgn-mobile-navigation a[href="#platform"]')
    else:
        anchor = driver.find_element(By.CSS_SELECTOR, '.vgn-nav-links a[href="#platform"]')
    anchor.click()
    WebDriverWait(driver, 6).until(lambda d: urlparse(d.current_url).fragment == "platform")
    position = driver.execute_script(
        """return {y:scrollY, top:document.querySelector('#platform')
           .getBoundingClientRect().top, h:document.querySelector('.vgn-header')
           .getBoundingClientRect().height}"""
    )
    assert position["y"] > 150, ("Anchor did not scroll:", position)
    assert -10 <= position["top"] <= position["h"] + 55, (
        "Anchor obscured or smooth-scrolling stalled:", position
    )


def main():
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
    if not chrome:
        raise RuntimeError("Chrome/Chromium must be installed for browser hit-testing")
    env = dict(os.environ)
    env.setdefault("VITE_SUPABASE_URL", "https://ci-test.supabase.co")
    env.setdefault("VITE_SUPABASE_ANON_KEY", "sb_publishable_ci_test_only_public_fixture")
    env.setdefault("VITE_VIDEO_STORAGE_PROVIDER", "b2")
    server = subprocess.Popen(
        ["npm", "run", "dev", "-w", "web"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    driver = None
    try:
        wait_for_server()
        options = webdriver.ChromeOptions()
        options.binary_location = chrome
        for arg in ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
                    "--disable-extensions", "--window-size=1440,900"]:
            options.add_argument(arg)
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(45)

        for width, height in BREAKPOINTS:
            driver.set_window_size(width, height)
            print(f"Checking native navigation at {width}x{height}", flush=True)
            if driver.execute_script("return innerWidth") <= 1020:
                check_click_target(driver, "", "/login")
                check_click_target(driver, "", "/register")
            else:
                check_click_target(driver, '.vgn-nav-actions a[href="/login"]', "/login")
                check_click_target(driver, '.vgn-nav-actions a[href="/register"]', "/register")
                check_click_target(driver, '.vgn-nav-actions a[href="/register"]',
                                   "/register", scrolled=True)
            check_click_target(driver, '.vgn-cta-actions a[href="/register"]', "/register")
            check_click_target(driver, '.vgn-cta-actions a[href="/login"]', "/login")
            check_anchor_scroll(driver)

        print("PASS: real Chrome link hit-testing and native navigation at all breakpoints", flush=True)
    finally:
        if driver:
            driver.quit()
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()

"""Browser-level regression: public links must be real, hoverable and clickable.

Runs Chrome against a local Vite server using synthetic public CI settings.
The test checks actual browser elementFromPoint hit testing and native route
navigation. React DOM unit tests alone cannot detect transparent overlays.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait

BASE = os.environ.get("VISIONGUARD_SMOKE_BASE", "http://127.0.0.1:3000")
BREAKPOINTS = [(1440, 900), (1024, 768), (768, 900), (390, 844)]
GEOMETRY_VIEWPORTS = [(320, 720), (375, 812), (768, 1024), (1440, 900), (2560, 1440)]


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
    def settled_position(d):
        position = d.execute_script(
            """return {y:scrollY, top:document.querySelector('#platform')
               .getBoundingClientRect().top, h:document.querySelector('.vgn-header')
               .getBoundingClientRect().height}"""
        )
        return position if position["y"] > 150 and position["h"] <= position["top"] <= position["h"] + 55 else False

    position = WebDriverWait(driver, 6).until(settled_position, "Platform anchor must scroll below the sticky header")
    assert position["y"] > 150, ("Anchor did not scroll:", position)
    assert position["h"] <= position["top"] <= position["h"] + 55, (
        "Anchor obscured or smooth-scrolling stalled:", position
    )



def check_responsive_geometry(driver, width: int, height: int):
    """CDP emulation avoids Chrome headless's minimum outer-window width."""
    driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": width <= 768,
    })
    navigate_home(driver)
    layout = driver.execute_script(
        """const selectors=['.vgn-nav','.vgn-hero-content','.vgn-hero-content h1',
                            '.vgn-hero-actions','.vgn-hero-demo'];
           const clipped=selectors.flatMap(selector => {
             const el=document.querySelector(selector);
             if(!el)return [selector+': missing'];
             const r=el.getBoundingClientRect();
             return (r.left < -2 || r.right > innerWidth+2)
                 ? [selector+': ['+r.left.toFixed(1)+','+r.right.toFixed(1)+']']
                 : [];
           });
           return { viewport: innerWidth, document: document.documentElement.scrollWidth,
                    clipped };"""
    )
    assert layout["viewport"] == width, ("Viewport emulation failed:", layout)
    assert layout["document"] <= width + 2, ("Landing horizontal overflow:", layout)
    assert not layout["clipped"], ("Landing elements clipped:", layout)

    if width <= 1020:
        menu = driver.find_element(By.CSS_SELECTOR, ".vgn-menu-button")
        assert menu.is_displayed(), ("Mobile navigation button missing:", width)
        menu.click()
        assert menu.get_attribute("aria-expanded") == "true"
        assert driver.find_element(By.CSS_SELECTOR, ".vgn-mobile-navigation").is_displayed()
        menu.click()
        assert menu.get_attribute("aria-expanded") == "false"

    theme = driver.find_element(By.CSS_SELECTOR, '.vgn-nav select[aria-label="Color theme"]')
    assert theme.value_of_css_property("opacity") == "1", "The selected theme should be visible"
    Select(theme).select_by_value("dark")
    WebDriverWait(driver, 5).until(lambda d: d.find_element(By.TAG_NAME, "html").get_attribute("data-theme") == "dark")
    Select(theme).select_by_value("system")

    driver.find_element(By.XPATH, '//button[normalize-space()="Follow"]').click()
    WebDriverWait(driver, 5).until(lambda d: d.execute_script("""
        const frame = document.querySelector('.vgn-stage-image img');
        return frame?.complete && frame.naturalWidth > 0 &&
          frame.getAttribute('src') === '/imagery/motorway-detections.webp';
    """))

    for route in ("/login", "/register"):
        driver.get(BASE + route)
        WebDriverWait(driver, 15).until(
            lambda d: bool(d.find_elements(By.CSS_SELECTOR, ".vg-auth-form"))
        )
        layout = driver.execute_script(
            """return {viewport:innerWidth,document:document.documentElement.scrollWidth,
                       formRight:document.querySelector('.vg-auth-form').getBoundingClientRect().right};"""
        )
        assert layout["document"] <= width + 2, (
            "Authentication horizontal overflow:", route, layout
        )
        assert layout["formRight"] <= width + 2, (
            "Authentication form exceeds viewport:", route, layout
        )



def main():
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
    if not chrome:
        raise RuntimeError("Chrome/Chromium must be installed for browser hit-testing")
    env = dict(os.environ)
    env.setdefault("VITE_SUPABASE_URL", "https://ci-test.supabase.co")
    env.setdefault("VITE_SUPABASE_ANON_KEY", "sb_publishable_ci_test_only_public_fixture")
    env.setdefault("VITE_VIDEO_STORAGE_PROVIDER", "b2")
    server = None
    if "VISIONGUARD_SMOKE_BASE" not in os.environ:
        server = subprocess.Popen(
            ["npm", "run", "dev", "-w", "web"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            start_new_session=True,
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

        for width, height in GEOMETRY_VIEWPORTS:
            print(f"Checking responsive page geometry at {width}x{height}", flush=True)
            check_responsive_geometry(driver, width, height)
        driver.execute_cdp_cmd("Emulation.clearDeviceMetricsOverride", {})

        print("PASS: Chrome navigation + phone/tablet/desktop/ultrawide geometry", flush=True)
    finally:
        if driver:
            driver.quit()
        if server and server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()


if __name__ == "__main__":
    main()

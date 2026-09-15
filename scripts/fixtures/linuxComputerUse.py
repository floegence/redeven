"""Deterministic native X11 controls for real Flower UI qualification."""

import json
import pathlib
import sys
import tkinter as tk

result = pathlib.Path(sys.argv[1])
window = tk.Tk()
window.title("Flower Linux Fixture")
window.geometry("960x620+60+60")
window.configure(background="#d6f5e5")
state = {"clicks": 0, "doubleClicked": False, "entered": False, "scrollEvents": 0}
summary = tk.StringVar()


def save():
    summary.set(f"Clicks: {state['clicks']}    Double: {state['doubleClicked']}    "
                f"Entered: {state['entered']}    Scroll: {state['scrollEvents']}")
    # Observers must see one complete snapshot while X11 events keep arriving.
    pending = result.with_suffix(".pending")
    pending.write_text(json.dumps(state), encoding="utf-8")
    pending.replace(result)


def click():
    state["clicks"] += 1
    save()


def double_click(_event):
    state["doubleClicked"] = True
    save()


def entered(_event):
    state["entered"] = entry.get() == "Flower"
    save()


def scroll(_event):
    state["scrollEvents"] += 1
    save()


tk.Label(window, text="Flower Linux Fixture", font=("sans", 28), bg="#d6f5e5").pack(pady=20)
tk.Button(window, text="Complete Linux step", font=("sans", 22), command=click).pack(pady=10)
double = tk.Label(window, text="Double click this blue area", font=("sans", 20), bg="#9fc9ff", padx=30, pady=14)
double.pack(pady=10)
double.bind("<Double-Button-1>", double_click)
tk.Label(window, text="Enter Flower below, then press Enter", font=("sans", 18), bg="#d6f5e5").pack()
entry = tk.Entry(window, font=("sans", 22))
entry.pack(pady=10)
entry.bind("<Return>", entered)
wheel = tk.Label(window, text="Scroll down here", font=("sans", 22), bg="#fff1c9", padx=80, pady=25)
wheel.pack(pady=10)
wheel.bind("<Button-5>", scroll)
tk.Label(window, textvariable=summary, font=("sans", 17), bg="#d6f5e5").pack(pady=15)
marker = tk.Label(window, width=3, height=1)
marker.place(x=915, y=12)


def animate(step=0):
    marker.configure(background=f"#{(step * 41) % 256:02x}60{(step * 67) % 256:02x}")
    window.after(200, animate, step + 1)


save()
animate()
window.mainloop()

"""Static reference poses, completion sequence and directional running."""
from pathlib import Path
import ctypes
from ctypes import wintypes
import time
import math
from collections import deque
import tkinter as tk
from PIL import Image, ImageTk, ImageChops

ASSETS = Path(__file__).resolve().parent / "assets"
PET_SIZE = 115
DEPTH_PHASES = {
    "turn": (.18, (0,)),
    "crouch": (.2, (0, 1)),
    "jump": (.6, (2, 3)),
    "land": (.32, (4, 5, 6)),
    "hug": (.7, (6, 7, 7)),
    "recover": (.48, (7, 6, 5, 4, 0)),
}


def icon_perch_position(px, py, half_icon):
    # The new sprite's two short paws straddle the icon's top edge at y=87.
    return px-PET_SIZE/2, py-half_icon-87*PET_SIZE/115


def depth_frame_index(phase, elapsed):
    duration, frames = DEPTH_PHASES[phase]
    return frames[min(len(frames)-1, max(0, int(elapsed/duration*len(frames))))]


def map_screen_point(x, y, physical, logical):
    pl, pt, pr, pb = physical
    ll, lt, lr, lb = logical
    return (ll+(x-pl)*(lr-ll)/(pr-pl), lt+(y-pt)*(lb-lt)/(pb-pt))


def screen_point_to_tk(x, y):
    """Convert even points outside the pet window, preserving monitor origins."""
    class MonitorInfo(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("monitor", wintypes.RECT),
                    ("work", wintypes.RECT), ("flags", wintypes.DWORD)]
    u = ctypes.windll.user32
    u.SetThreadDpiAwarenessContext.argtypes = (ctypes.c_void_p,)
    u.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    u.MonitorFromPoint.argtypes = (wintypes.POINT, wintypes.DWORD)
    u.MonitorFromPoint.restype = wintypes.HANDLE
    u.GetMonitorInfoW.argtypes = (wintypes.HANDLE, ctypes.POINTER(MonitorInfo))
    def bounds(handle):
        info = MonitorInfo()
        info.size = ctypes.sizeof(info)
        if not u.GetMonitorInfoW(handle, ctypes.byref(info)):
            raise RuntimeError("无法换算屏幕坐标，已取消图标动画。")
        r = info.monitor
        return r.left, r.top, r.right, r.bottom
    previous = u.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    if not previous:
        raise RuntimeError("无法读取屏幕缩放比例。")
    try:
        monitor = u.MonitorFromPoint(wintypes.POINT(round(x), round(y)), 2)
        physical = bounds(monitor)
    finally:
        u.SetThreadDpiAwarenessContext(previous)
    return map_screen_point(x, y, physical, bounds(monitor))


def smooth_progress(value):
    t = max(0, min(1, value))
    return t*t*t*(t*(t*6-15)+10)


def jump_position(origin, destination, progress):
    t = max(0, min(1, progress))
    eased = smooth_progress(t)
    return (origin[0]+(destination[0]-origin[0])*eased,
            origin[1]+(destination[1]-origin[1])*eased-56*math.sin(math.pi*t)**2)


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def desktop_idle_seconds():
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def state_for_status(value):
    if "处理" in value:
        return "工作"
    if "听" in value or "回复" in value:
        return "聆听"
    return "准备"


class PetBehavior:
    def __init__(self):
        self.state = "哈欠"
        self.work_pending = False
        self.deadline = None
        self.entered_at = time.monotonic()
        self.deadline = self.entered_at + 1.4

    def enter(self, state):
        self.state, self.deadline = state, None
        self.entered_at = time.monotonic()

    def prepare_sleep(self, now):
        self.work_pending = False
        self.enter("哈欠")
        self.deadline = now + 1.4

    def sleep_if_idle(self, seconds, now=None):
        if self.state == "站立" and not self.work_pending and seconds >= 3:
            self.prepare_sleep(time.monotonic() if now is None else now)

    def wake(self, now=None):
        was_sleepy = self.state in ("睡觉", "哈欠")
        self.work_pending = False
        self.enter("醒来" if was_sleepy else "站立")
        if was_sleepy:
            self.deadline = (time.monotonic() if now is None else now) + .3

    def work(self):
        self.work_pending = True
        self.enter("工作")

    def complete(self, now):
        self.work_pending = False
        self.enter("庆祝")
        self.deadline = now + 1.2

    def status_changed(self, text, now):
        state = state_for_status(text)
        if state == "工作":
            self.work()
        elif state == "聆听":
            self.enter("聆听")
        elif self.work_pending:
            self.complete(now)
        elif self.state == "聆听":
            self.enter("站立")

    def tick(self, now):
        if self.deadline is not None and now >= self.deadline:
            if self.state == "庆祝":
                self.state = "哈欠"
                self.deadline += 1.4
            elif self.state == "醒来":
                self.enter("站立")
            else:
                self.enter("睡觉")


TRANSITION_EDGES = (("睡觉", "站立"), ("站立", "聆听"), ("站立", "工作"),
                    ("工作", "庆祝"), ("庆祝", "哈欠"), ("站立", "哈欠"),
                    ("哈欠", "睡觉"), ("站立", "跑右"))


def transition_route(source, target, edges=TRANSITION_EDGES):
    pending = deque([(source, [])])
    visited = {source}
    while pending:
        node, route = pending.popleft()
        if node == target:
            return route
        for a, b in edges:
            other = b if a == node else a if b == node else None
            if other is not None and other not in visited:
                visited.add(other)
                pending.append((other, route + [(node, other)]))
    raise ValueError(f"缺少过渡动作：{source} -> {target}")


class MotionPlayer:
    """Finish the current short motion before routing toward the latest requested pose."""
    def __init__(self, poses, clips):
        self.poses, self.clips = poses, clips
        self.current = "哈欠"
        self.target = self.current
        self.edge = None
        self.started = 0

    def busy(self):
        return self.edge is not None or self.current != self.target

    def sample(self, target, now):
        if target.startswith("跑") and self.target.startswith("跑") and target != self.target:
            # Reverse the run immediately, including during a stand-to-run transition.
            self.edge = None
            self.current = target
        self.target = target
        if self.edge is not None:
            frames = self.clips[self.edge]
            index = int((now-self.started)/.09)
            if index < len(frames):
                return frames[index]
            self.current = self.edge[1]
            self.edge = None
        if self.current != target:
            self.edge = transition_route(self.current, target, tuple(self.clips))[0]
            self.started = now
            return self.clips[self.edge][0]
        return self.poses[self.current][0]


def keyed(frame):
    frame = frame.convert("RGBA")
    red, green, blue, alpha = frame.split()
    key = ImageChops.multiply(ImageChops.multiply(red.point(lambda v: 255 if v > 180 else 0), green.point(lambda v: 255 if v < 115 else 0)), blue.point(lambda v: 255 if v > 180 else 0))
    frame.putalpha(ImageChops.subtract(alpha.point(lambda v: 255 if v >= 128 else 0), key))
    return frame


class CatWindow(tk.Toplevel):
    def __init__(self, master):
        super().__init__(master)
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(bg="#ff00ff")
        self.attributes("-transparentcolor", "#ff00ff")
        self.geometry(f"{PET_SIZE}x{PET_SIZE}+40+120")
        self.canvas = tk.Canvas(self, width=PET_SIZE, height=PET_SIZE, bg="#ff00ff", highlightthickness=0)
        self.canvas.pack()
        self.status = tk.StringVar(value="准备好了")
        self.frames = self._load_frames()
        self.motion = MotionPlayer(self.frames, self.clips)
        self.item = self.canvas.create_image(PET_SIZE//2, PET_SIZE//2)
        # Solid pixel polygons avoid font antialiasing against the transparency key.
        self.zzz = [self.canvas.create_polygon(0, 0, 1, 0, 1, 1, fill="#000000", outline="", state="hidden") for _ in range(3)]
        self.behavior = PetBehavior()
        self.dragging = False
        self.direction = "右"
        self._drag = (0, 0)
        self._press = (0, 0)
        self._last_x = 0
        self._run_start = time.monotonic()
        self._sleep_start = self._run_start
        self._shown = None
        self._animation_timer = None
        self._trip = None
        self._last_tick = time.monotonic()
        self.menu = tk.Menu(self, tearoff=False)
        self.menu.add_command(label="打开聊天", command=self.show_chat)
        self.menu.add_command(label="隐藏聊天窗口", command=master.withdraw)
        self.menu.add_separator()
        self.menu.add_command(label="站起来（图二）", command=self.behavior.wake)
        self.menu.add_command(label="开始工作（图三）", command=self.behavior.work)
        self.menu.add_command(label="工作完成（图四 → 图五 → 睡觉）", command=lambda: self.behavior.complete(time.monotonic()))
        self.menu.add_command(label="听我说话（图六）", command=lambda: self.behavior.enter("聆听"))
        self.menu.add_command(label="睡觉（图一）", command=self._sleep)
        self.menu.add_separator()
        self.menu.add_command(label="退出哒哒", command=lambda: master.event_generate("<<QuitPet>>"))
        self.bind("<ButtonPress-1>", self._drag_start)
        self.bind("<B1-Motion>", self._drag_move)
        self.bind("<ButtonRelease-1>", self._drag_end)
        self.bind("<Double-Button-1>", lambda e: self.show_chat())
        self.bind("<Button-3>", lambda e: self.menu.tk_popup(e.x_root, e.y_root))
        self.status.trace_add("write", self._status_changed)
        self._animate()

    def _load_frames(self):
        result = {}
        poses = {"睡觉": (3, 3), "站立": (1, 2), "工作": (0, 1), "庆祝": (0, 4), "哈欠": (3, 1), "聆听": (1, 1)}
        with Image.open(ASSETS / "cat-actions.png") as atlas:
            w, h = atlas.size
            for name, (row, col) in poses.items():
                top, bottom = ((40, 280), (290, 525), (550, 760), (785, 1005))[row]
                frame = keyed(atlas.crop((round(col*w/6), round(top*h/1024), round((col+1)*w/6), round(bottom*h/1024))))
                box = frame.getbbox()
                if box is None:
                    raise ValueError(f"姿势素材为空：{name}")
                sprite = frame.crop(box)
                cell = Image.new("RGBA", (256, 256))
                cell.paste(sprite, ((256-sprite.width)//2, 248-sprite.height))
                result[name] = [ImageTk.PhotoImage(cell.resize((PET_SIZE, PET_SIZE), Image.Resampling.NEAREST), master=self)]
        with Image.open(ASSETS / "cat-actions-smooth.png") as atlas:
            w, h = atlas.size
            frames = [keyed(atlas.crop((round(c*w/8), round(h/2), round((c+1)*w/8), round(3*h/4)))).resize((256, 256), Image.Resampling.NEAREST) for c in range(8)]
            boxes = [f.getbbox() for f in frames]
            left, right, bottom = min(b[0] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)
            result["跑右"], result["跑左"] = [], []
            for frame in frames:
                cell = Image.new("RGBA", (256, 256))
                cell.paste(frame, ((256-left-right)//2, 248-bottom))
                padded = Image.new("RGBA", (PET_SIZE, PET_SIZE))
                padded.paste(cell.resize((PET_SIZE-8, PET_SIZE-8), Image.Resampling.NEAREST), (4, 4))
                cell = padded
                result["跑右"].append(ImageTk.PhotoImage(cell, master=self))
                result["跑左"].append(ImageTk.PhotoImage(cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT), master=self))
        self.clips = {}
        with Image.open(ASSETS / "cat-transitions.png") as atlas:
            w, h = atlas.size
            for row, edge in enumerate(TRANSITION_EDGES):
                sequence = []
                for col in range(8):
                    frame = keyed(atlas.crop((round(col*w/8), round(row*h/8), round((col+1)*w/8), round((row+1)*h/8))))
                    cell = Image.new("RGBA", (PET_SIZE, PET_SIZE))
                    cell.paste(frame.resize((PET_SIZE-8, PET_SIZE-8), Image.Resampling.NEAREST), (4, 4))
                    sequence.append(cell)
                # These rows reach their intended endpoint at cell seven.
                if row in (0, 3):
                    sequence = sequence[:7]
                self.clips[edge] = [ImageTk.PhotoImage(f, master=self) for f in sequence]
                self.clips[edge[::-1]] = list(reversed(self.clips[edge]))
                if row == 7:
                    left = [ImageTk.PhotoImage(f.transpose(Image.Transpose.FLIP_LEFT_RIGHT), master=self) for f in sequence]
                    self.clips[("站立", "跑左")] = left
                    self.clips[("跑左", "站立")] = list(reversed(left))
        # Held poses use the exact transition endpoints, avoiding a final snap.
        for state, edge, index in (("睡觉", ("睡觉", "站立"), 0),
                                   ("站立", ("睡觉", "站立"), -1),
                                   ("聆听", ("站立", "聆听"), -1),
                                   ("工作", ("站立", "工作"), -1),
                                   ("庆祝", ("工作", "庆祝"), -1),
                                   ("哈欠", ("哈欠", "睡觉"), 0)):
            result[state] = [self.clips[edge][index]]
        for (source, target), frames in self.clips.items():
            frames[0] = result[source][0]
            frames[-1] = result[target][0]
        self.depth_frames = {"右": [], "左": []}
        with Image.open(ASSETS / "cat-icon-perch-v1.png") as atlas:
            w, h = atlas.size
            for index in range(8):
                row, col = divmod(index, 4)
                cell = keyed(atlas.crop((round(col*w/4), round(row*h/2),
                                        round((col+1)*w/4), round((row+1)*h/2))))
                cell = cell.resize((PET_SIZE, PET_SIZE), Image.Resampling.NEAREST)
                self.depth_frames["右"].append(ImageTk.PhotoImage(cell, master=self))
                self.depth_frames["左"].append(ImageTk.PhotoImage(cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT), master=self))
        return result

    def show_chat(self):
        self.master.deiconify()
        self.master.lift()

    def _sleep(self):
        self.behavior.prepare_sleep(time.monotonic())

    def _status_changed(self, *_):
        self.behavior.status_changed(self.status.get(), time.monotonic())

    def run_and_tap(self, target, callback):
        if self._trip:
            raise RuntimeError("哒哒正在跑动，请稍等。")
        self.update_idletasks()
        px, py = screen_point_to_tk(target["x"], target["y"])
        self.direction = "右" if px >= self.winfo_x() + PET_SIZE/2 else "左"
        icon_size = target.get("icon_size", 60)
        right, _ = screen_point_to_tk(target["x"]+icon_size/2, target["y"])
        half_icon = min(36, max(12, right-px))
        approach_side = -1 if self.direction == "右" else 1
        landing = icon_perch_position(px, py, half_icon)
        self._trip = dict(x=float(self.winfo_x()), y=float(self.winfo_y()),
                          tx=landing[0]+approach_side*65, ty=landing[1]+35,
                          landing=landing,
                          origin=(self.winfo_x(), self.winfo_y()), move_started=None,
                          phase="run", started=time.monotonic(), callback=callback)
        self.behavior.enter("站立")
        self._run_start = time.monotonic()
        self.status.set("去抱谷歌图标")

    def _move_trip(self, now, elapsed):
        trip = self._trip
        if not trip:
            return
        if trip["phase"] == "run" and not self.motion.busy() and self.motion.current == "跑"+self.direction:
            if trip["move_started"] is None:
                trip["move_started"] = now
            ox, oy = trip["origin"]
            distance = math.hypot(trip["tx"]-ox, trip["ty"]-oy)
            duration = max(.6, distance/420)
            progress = min(1, (now-trip["move_started"])/duration)
            eased = smooth_progress(progress)
            trip["x"] = ox+(trip["tx"]-ox)*eased
            trip["y"] = oy+(trip["ty"]-oy)*eased
            self.geometry(f"+{round(trip['x'])}+{round(trip['y'])}")
            if progress >= 1:
                trip["phase"] = "settle"
        elif trip["phase"] == "settle" and not self.motion.busy() and self.motion.current == "站立":
            trip["phase"], trip["started"] = "turn", now
            self.status.set("跳到图标后面")
        elif trip["phase"] in DEPTH_PHASES:
            phase = trip["phase"]
            t = min(1, (now-trip["started"])/DEPTH_PHASES[phase][0])
            if phase == "jump":
                x, y = jump_position((trip["tx"], trip["ty"]), trip["landing"], t)
                self.geometry(f"+{round(x)}+{round(y)}")
            if t >= 1:
                if phase == "recover":
                    self._trip = None
                    trip["callback"](True)
                else:
                    phases = tuple(DEPTH_PHASES)
                    trip["phase"], trip["started"] = phases[phases.index(phase)+1], now
                    if trip["phase"] == "hug":
                        self.status.set("趴好啦，打开谷歌")
                    elif trip["phase"] == "recover":
                        self.status.set("收好爪子啦")

    def cancel_trip(self):
        if self._trip:
            callback = self._trip["callback"]
            self._trip = None
            callback(False)

    def _animate(self):
        now = time.monotonic()
        elapsed = now-self._last_tick
        self._last_tick = now
        self._move_trip(now, elapsed)
        running = self.dragging or bool(self._trip and self._trip["phase"] == "run")
        # Pose holds begin after the transition has arrived, not while it is playing.
        if self.motion.busy() and self.behavior.deadline is not None:
            self.behavior.deadline += elapsed
        self.behavior.tick(now)
        if not self.dragging and not self._trip and not self.motion.busy():
            self.behavior.sleep_if_idle(min(desktop_idle_seconds(), now-self.behavior.entered_at), now)
        state = "跑" + self.direction if running else "站立" if self._trip else self.behavior.state
        if state == "醒来":
            state = "站立"
        if self.dragging and self.motion.edge is None and self.motion.current.startswith("跑"):
            self.motion.current = state
        frame = self.motion.sample(state, now)
        index = int((now-self._run_start)/0.065) % 8 if running else 0
        if running and not self.motion.busy():
            frame = self.frames[state][index]
        if self._trip and self._trip["phase"] in DEPTH_PHASES:
            index = depth_frame_index(self._trip["phase"], now-self._trip["started"])
            frame = self.depth_frames[self.direction][index]
        shown = (state, str(frame))
        if shown != self._shown:
            if state == "睡觉" and (self._shown is None or self._shown[0] != "睡觉"):
                self._sleep_start = now
            self.canvas.itemconfigure(self.item, image=frame)
            self._shown = shown
        for i, item in enumerate(self.zzz):
            if state == "睡觉" and not self.motion.busy():
                phase = ((now-self._sleep_start)/2.8 + i/3) % 1
                x, y = round(76+18*phase), round(65-48*phase)
                scale = 2 if phase > .55 else 1
                shape = ((0,0),(5,0),(5,1),(1,4),(5,4),(5,5),(0,5),(0,4),(4,1),(0,1))
                self.canvas.coords(item, *[v for px, py in shape for v in (x+px*scale, y+py*scale)])
                self.canvas.itemconfigure(item, state="normal", fill="#000000")
            else:
                self.canvas.itemconfigure(item, state="hidden")
        self._animation_timer = self.after(16, self._animate)

    def destroy(self):
        if self._animation_timer is not None:
            self.after_cancel(self._animation_timer)
            self._animation_timer = None
        super().destroy()

    def _drag_start(self, event):
        self.cancel_trip()
        self._drag = (event.x_root-self.winfo_x(), event.y_root-self.winfo_y())
        self._press = (event.x_root, event.y_root)
        self._last_x = event.x_root

    def _drag_move(self, event):
        if not self.dragging and max(abs(event.x_root-self._press[0]), abs(event.y_root-self._press[1])) < 4:
            return
        if not self.dragging:
            self._run_start = time.monotonic()
        self.dragging = True
        dx = event.x_root-self._last_x
        if dx:
            self.direction = "右" if dx > 0 else "左"
        self._last_x = event.x_root
        x = max(0, min(self.winfo_screenwidth()-PET_SIZE, event.x_root-self._drag[0]))
        y = max(0, min(self.winfo_screenheight()-PET_SIZE, event.y_root-self._drag[1]))
        self.geometry(f"+{x}+{y}")

    def _drag_end(self, event):
        was_dragging = self.dragging
        self.dragging = False
        if not was_dragging or self.behavior.state == "睡觉":
            self.behavior.wake()

"""Parent-owned desktop pet; only fixed UI events cross the private pipes."""
import queue
import json
import sys
import threading
import time
import ctypes
import tkinter as tk
from agenda_pet.pet_window import CatWindow


def enable_crisp_dpi():
    # Set before Tk creates any window: avoid Windows bitmap-stretching the text.
    user32=ctypes.windll.user32
    user32.SetProcessDpiAwarenessContext.argtypes=(ctypes.c_void_p,)
    user32.SetProcessDpiAwarenessContext.restype=ctypes.c_bool
    if not user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
        user32.SetThreadDpiAwarenessContext.argtypes=(ctypes.c_void_p,)
        user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))


class AgendaCat(CatWindow):
    def __init__(self, master, emit):
        self.emit = emit
        self._today_click = None
        self._double_clicked = False
        self.bubble = None
        self._bubble_follow = None
        self._bubble_text = ''
        super().__init__(master)
        self.title('Agenda Pet')
        self.menu.delete(0, 'end')
        self.menu.add_command(label='打开 Agenda AI / Open AI', command=self.show_chat)
        self.menu.add_command(label='睡觉 / Sleep', command=self._sleep)
        self.menu.add_command(label='关闭宠物 / Disable pet', command=lambda: self.emit('disable'))
        self.menu.add_command(label='今日待办 / Today', command=self.show_today)
        self.theme = 'light'
        self.popup = None
        self.bind('<Button-3>', self.show_menu)

    def set_theme(self, theme):
        if theme not in ('light', 'dark'): return
        self.theme = theme
        self.close_menu()
        if self.bubble is not None: self.show_bubble(self._bubble_text)

    def close_bubble(self):
        if self._bubble_follow is not None:
            self.after_cancel(self._bubble_follow); self._bubble_follow = None
        if self.bubble is not None:
            self.bubble.destroy(); self.bubble = None

    def show_bubble(self, text):
        if not text: return
        self.close_bubble(); self._bubble_text = text
        dark = self.theme == 'dark'
        bg, fg = ('#303844','#f4f8ff') if dark else ('#edf6ff','#193b56')
        rim = '#8293aa' if dark else '#ffffff'
        bubble = self.bubble = tk.Toplevel(self)
        bubble.withdraw(); bubble.overrideredirect(True); bubble.attributes('-topmost', True)
        bubble.configure(bg='#ff00ff'); bubble.attributes('-transparentcolor','#ff00ff')
        bubble.attributes('-alpha',.91 if dark else .88)
        scale=self.winfo_fpixels('1i')/96
        px=lambda value:round(value*scale)
        width, height = px(390), px(280)
        canvas = tk.Canvas(bubble,width=width,height=height,bg='#ff00ff',highlightthickness=0)
        canvas.pack()
        surface=canvas.create_polygon(18,0,372,0,390,0,390,18,390,244,390,262,372,262,18,262,0,262,0,244,0,18,0,0,
                              smooth=True,fill=bg,outline=rim,width=max(1,px(1)))
        canvas.scale(surface,0,0,scale,scale)
        # A restrained reflection leaves the message area calm and readable.
        shine=canvas.create_line(px(20),px(2),px(370),px(2),fill='#aebed2' if dark else '#ffffff',width=px(2),capstyle='round')
        tail=canvas.create_polygon(0,0,0,0,0,0,fill=bg)
        top_tail=canvas.create_polygon(155,20,175,2,195,20,fill=bg,state='hidden')
        tk.Label(bubble,text='Agenda',bg=bg,fg=fg,font=('Segoe UI',-px(15),'bold')).place(x=px(20),y=px(12))
        tk.Button(bubble,text='×',command=self.close_bubble,bg=bg,fg=fg,activebackground=bg,
                  activeforeground=fg,relief='flat',bd=0,font=('Segoe UI',-px(22))).place(x=px(345),y=px(8),width=px(30),height=px(30))
        body=tk.Text(bubble,wrap='word',bg=bg,fg=fg,relief='flat',bd=0,font=('Microsoft YaHei UI',-px(16)),
                     padx=px(2),pady=px(6),spacing1=px(2),spacing3=px(5),highlightthickness=0,selectbackground='#6688aa')
        body.insert('1.0',text);body.configure(state='disabled');body.place(x=px(20),y=px(48),width=px(338),height=px(194))
        # Canvas thumb avoids Windows' bright, oversized native scrollbar.
        scroll=tk.Canvas(bubble,bg=bg,highlightthickness=0,width=px(5),height=px(194))
        scroll.place(x=px(368),y=px(48),width=px(5),height=px(194))
        def scrollbar(first,last):
            scroll.delete('all')
            if float(last)-float(first)<.999:
                scroll.create_line(px(2),max(px(3),float(first)*px(194)),px(2),max(px(12),float(last)*px(194)),fill='#727e91' if self.theme=='dark' else '#8ca6bc',width=px(4),capstyle='round')
        body.configure(yscrollcommand=scrollbar)
        scroll.bind('<Button-1>',lambda event:body.yview_moveto(event.y/px(194)))
        scroll.bind('<B1-Motion>',lambda event:body.yview_moveto(event.y/px(194)))
        positions=[(widget,int(widget.place_info()['y'])) for widget in bubble.winfo_children() if widget is not canvas]
        offset=0
        def follow():
            nonlocal offset
            if self.bubble is not bubble: return
            center=self.winfo_x()+self.winfo_width()//2
            x=max(0,min(center-width//2,self.winfo_screenwidth()-width))
            above=self.winfo_y()>=height
            y=self.winfo_y()-height if above else self.winfo_y()+self.winfo_height()
            y=max(0,min(y,self.winfo_screenheight()-height))
            tip=max(px(25),min(center-x,width-px(25)))
            canvas.coords(tail,tip-px(15),px(260),tip,px(278),tip+px(15),px(260))
            canvas.itemconfigure(tail,state='normal' if above else 'hidden')
            canvas.coords(top_tail,tip-px(15),px(20),tip,px(2),tip+px(15),px(20))
            canvas.itemconfigure(top_tail,state='hidden' if above else 'normal')
            new_offset=0 if above else px(18)
            if new_offset!=offset:
                canvas.move(surface,0,new_offset-offset)
                canvas.move(shine,0,new_offset-offset)
                for widget,base_y in positions:widget.place_configure(y=base_y+new_offset)
                offset=new_offset
            bubble.geometry(f'{width}x{height}+{x}+{y}')
            self._bubble_follow=self.after(100,follow)
        follow();bubble.deiconify()

    def close_menu(self, _event=None):
        if self.popup is not None:
            self.popup.destroy(); self.popup = None

    def show_menu(self, event):
        self.close_menu()
        bg, fg, hover = ('#252932', '#e6ebf2', '#3a414d') if self.theme == 'dark' else ('#e8f1f8', '#29465c', '#d2e3f0')
        popup = self.popup = tk.Toplevel(self)
        popup.withdraw(); popup.overrideredirect(True); popup.attributes('-topmost', True)
        popup.configure(bg=bg, padx=8, pady=8)
        for index in range(4):
            def choose(i=index):
                self.close_menu(); self.menu.invoke(i)
            tk.Button(popup, text=self.menu.entrycget(index, 'label'), command=choose,
                      bg=bg, fg=fg, activebackground=hover, activeforeground=fg,
                      relief='flat', bd=0, anchor='w', padx=16, pady=9,
                      font=('Microsoft YaHei UI', 10), highlightthickness=1,
                      highlightbackground=bg, highlightcolor=hover).pack(fill='x')
        popup.update_idletasks()
        width, height = popup.winfo_reqwidth(), popup.winfo_reqheight()
        x=max(0,min(event.x_root,self.winfo_screenwidth()-width))
        y=max(0,min(event.y_root,self.winfo_screenheight()-height))
        popup.geometry(f'+{x}+{y}'); popup.deiconify(); popup.focus_force()
        popup.bind('<Escape>', self.close_menu)
        popup.bind('<FocusOut>', lambda e: popup.after_idle(lambda: self.close_menu() if self.popup is popup and popup.focus_displayof() is None else None))

    def _cancel_today_click(self):
        if self._today_click is not None:
            self.after_cancel(self._today_click); self._today_click = None

    def show_today(self):
        self._cancel_today_click()
        self.emit('open-today')

    def _drag_start(self, event):
        self._cancel_today_click()
        self._double_clicked = False
        super()._drag_start(event)

    def _drag_end(self, event):
        dragged = self.dragging
        super()._drag_end(event)
        if not dragged and not self._double_clicked:
            self._today_click = self.after(ctypes.windll.user32.GetDoubleClickTime()+30, self.show_today)

    def destroy(self):
        self.close_bubble()
        self.close_menu()
        self._cancel_today_click()
        super().destroy()

    def show_chat(self):
        self._cancel_today_click()
        self._double_clicked = True
        self.behavior.wake()
        self.emit('open-ai')

    def command(self, value):
        if value == 'working': self.behavior.work()
        elif value == 'done': self.behavior.complete(time.monotonic())
        elif value == 'idle': self.behavior.wake()


def main():
    enable_crisp_dpi()
    root = tk.Tk()
    root.withdraw()
    from agenda_pet import pet_window
    pet_window.PET_SIZE=round(115*root.winfo_fpixels('1i')/96)
    commands = queue.SimpleQueue()
    emit = lambda event: print(json.dumps(event, ensure_ascii=True) if isinstance(event, dict) else event, flush=True)
    cat = AgendaCat(root, emit)
    from agenda_pet.voice_bridge import VoiceBridge
    voice = VoiceBridge(cat, emit)

    def read_parent():
        while True:
            line = sys.stdin.buffer.readline(65536)
            if not line: break
            value = line.decode('utf-8', errors='ignore').strip()
            if value in ('working', 'done', 'idle', 'quit'): commands.put(value)
            elif value.startswith('{'):
                try:
                    message = json.loads(value)
                    if isinstance(message, dict): commands.put(message)
                except ValueError: pass
        commands.put('quit')

    def poll():
        while not commands.empty():
            value = commands.get()
            if value == 'quit':
                voice.stop(); cat.destroy(); root.destroy(); return
            if isinstance(value, dict):
                if value.get('type') == 'theme': cat.set_theme(value.get('value'))
                if value.get('type') == 'voice-config': voice.configure(value)
                elif value.get('type') == 'reply' and isinstance(value.get('text'), str):
                    if value.get('bubble') is True: cat.show_bubble(value['text'])
                    voice.reply(value['text'], value.get('ok') is True)
                elif value.get('type') == 'reminder' and isinstance(value.get('text'),str) and len(value['text'])<=20000:
                    cat.show_bubble(value['text'])
                    emit({'type':'reminder-shown','id':value.get('id')})
                elif value.get('type') == 'voice-preview' and not voice.busy and not voice.speaking: voice.say('我在，今天有什么需要我帮忙的吗？')
            else:
                cat.command(value)
                if value == 'working': voice.working()
        voice.poll()
        root.after(50, poll)

    threading.Thread(target=read_parent, daemon=True).start()
    root.after(50, poll)
    root.update_idletasks()
    print('ready', flush=True)
    root.mainloop()


if __name__ == '__main__':
    main()

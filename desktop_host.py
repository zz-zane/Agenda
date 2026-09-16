"""Frozen desktop backend. Private port, isolated user data, parent-owned lifetime."""
import argparse
from contextlib import closing
import ctypes
from ctypes import wintypes
import hmac
import json
import os
from pathlib import Path
import sqlite3
import sys
import threading

import local_server as app


def own_child_processes():
    """Windows closes the job on exit/crash and terminates any surviving DSH child."""
    class Basic(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_longlong), ('job_time', ctypes.c_longlong),
                    ('flags', wintypes.DWORD), ('min_working', ctypes.c_size_t),
                    ('max_working', ctypes.c_size_t), ('active_limit', wintypes.DWORD),
                    ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]
    class Limits(ctypes.Structure):
        _fields_ = [('basic', Basic), ('io', ctypes.c_ulonglong * 6),
                    ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
                    ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = Limits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    # Deliberately kept open until process exit; closing it kills this process tree.
    return job


def prepare_data(directory):
    directory.mkdir(parents=True, exist_ok=True)
    database = directory / 'calendar.db'
    if database.exists():
        backups = directory / 'backups'
        backups.mkdir(exist_ok=True)
        # One pre-v2 snapshot; later schema changes must use a new version name.
        backup = backups / 'before-desktop-v2.db'
        if not backup.exists():
            temporary = backups / 'before-desktop-v2.tmp'
            with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(temporary)) as target:
                source.backup(target)
            temporary.replace(backup)
    app.DATA = directory
    app.initialize()


def make_server(token):
    class DesktopHandler(app.Handler):
        def local_request(self):
            supplied = self.headers.get('X-Agenda-Desktop-Token', '')
            return super().local_request() and hmac.compare_digest(supplied.encode(), token.encode())

        def log_message(self, *args):
            pass  # Do not persist request paths or chat details in desktop logs.

        def do_HEAD(self):
            self.send_response(405 if self.local_request() else 403)
            self.end_headers()

    return app.ThreadingHTTPServer(('127.0.0.1', 0), DesktopHandler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.pop('AGENDA_DESKTOP_TOKEN', '')
    if len(token) != 64:
        raise ValueError('Desktop launcher required')
    job = own_child_processes()
    prepare_data(args.data.resolve())
    server = make_server(token)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    print(json.dumps({'port': server.server_port}), flush=True)
    try:
        # EOF also arrives if the desktop shell crashes; no orphan listener remains.
        while sys.stdin.buffer.read(1):
            pass
    finally:
        server.shutdown()
        server.server_close()
        worker.join(5)


if __name__ == '__main__':
    main()

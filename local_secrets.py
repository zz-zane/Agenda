"""Windows current-user DPAPI storage; the key never enters SQLite."""
import ctypes
from ctypes import wintypes
import os
import tempfile


class Blob(ctypes.Structure):
    _fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]


def crypt(raw, decrypt=False):
    if os.name!='nt':raise ValueError('加密保存密钥需要 Windows；其他系统请使用 AI_API_KEY 环境变量')
    buffer=ctypes.create_string_buffer(raw)
    source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)));target=Blob()
    dll=ctypes.WinDLL('crypt32',use_last_error=True)
    fn=dll.CryptUnprotectData if decrypt else dll.CryptProtectData
    fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    fn.restype=wintypes.BOOL
    if not fn(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)):raise ValueError('Windows 密钥加解密失败')
    try:return ctypes.string_at(target.data,target.size)
    finally:
        free=ctypes.windll.kernel32.LocalFree;free.argtypes=[ctypes.c_void_p];free.restype=ctypes.c_void_p;free(target.data)


def save(directory,key):
    encrypted=crypt(key.encode('utf-8'));directory.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=directory,prefix='.key-',delete=False) as file:
        temp=file.name;file.write(encrypted)
    try:os.replace(temp,directory/'ai-key.dpapi')
    finally:
        if os.path.exists(temp):os.unlink(temp)


def read(directory):
    try:return crypt((directory/'ai-key.dpapi').read_bytes(),decrypt=True).decode('utf-8')
    except FileNotFoundError:return ''

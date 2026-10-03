"""apktool로 디컴파일된 smali 트리를 다루는 최소한의 엔진.

난독화된 YouTube TV 앱은 버전마다 클래스/메서드 이름이 바뀌므로,
메서드 안의 문자열 상수, 시그니처, opcode 같은 변하지 않는 특징(fingerprint)으로
대상 메서드를 찾는다. (ReVanced patcher의 fingerprint 개념과 동일)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

METHOD_RE = re.compile(r"^\.method (?P<flags>(?:[\w-]+ )*)(?P<name>[^(\s]+)\((?P<params>[^)]*)\)(?P<ret>\S+)")
CONST_STRING_RE = re.compile(r'const-string(?:/jumbo)? [vp]\d+, "(.*)"$')
LOCALS_RE = re.compile(r"^\s*\.locals (\d+)")
REGISTERS_RE = re.compile(r"^\s*\.registers (\d+)")


@dataclass
class Method:
    file: "SmaliFile"
    start: int  # .method 줄 인덱스
    end: int  # .end method 줄 인덱스
    flags: list[str]
    name: str
    params: str
    ret: str

    @property
    def cls(self) -> str:
        return self.file.cls

    @property
    def body(self) -> list[str]:
        return self.file.lines[self.start : self.end + 1]

    @property
    def strings(self) -> list[str]:
        out = []
        for line in self.body:
            m = CONST_STRING_RE.search(line.strip())
            if m:
                out.append(m.group(1))
        return out

    @property
    def is_static(self) -> bool:
        return "static" in self.flags

    @property
    def ref(self) -> str:
        return f"{self.cls}->{self.name}({self.params}){self.ret}"

    def __repr__(self) -> str:
        return f"<Method {self.ref}>"

    # ---- 레지스터 ----
    def locals_count(self) -> int:
        for line in self.body:
            m = LOCALS_RE.match(line)
            if m:
                return int(m.group(1))
            m = REGISTERS_RE.match(line)
            if m:
                return int(m.group(1)) - self.param_register_count()
        raise ValueError(f"locals 지시자가 없음: {self}")

    def param_register_count(self) -> int:
        n = 0 if self.is_static else 1
        for t in split_params(self.params):
            n += 2 if t in ("J", "D") else 1
        return n

    def ensure_locals(self, needed: int) -> None:
        """메서드 앞부분에 쓸 임시 레지스터를 최소 needed개 확보한다.

        locals를 늘리면 p 레지스터 번호가 밀려나므로, 원래 코드는 p 레지스터 이름으로
        쓰여 있어 안전하다(apktool 출력은 항상 p 표기를 사용).
        단, 파라미터 레지스터가 v16 이상으로 밀리면 일부 opcode에서 문제가 생길 수 있으니 주의.
        """
        lines = self.file.lines
        for i in range(self.start, self.end):
            m = LOCALS_RE.match(lines[i])
            if m:
                if int(m.group(1)) < needed:
                    lines[i] = re.sub(r"\d+", str(needed), lines[i], count=1)
                return
            m = REGISTERS_RE.match(lines[i])
            if m:
                total = int(m.group(1))
                if total - self.param_register_count() < needed:
                    lines[i] = re.sub(r"\d+", str(needed + self.param_register_count()), lines[i], count=1)
                return
        raise ValueError(f"locals 지시자가 없음: {self}")

    # ---- 코드 삽입 ----
    def first_instruction_index(self) -> int:
        """첫 실행 명령(또는 라벨) 줄의 인덱스. 지시자(.locals/.param/.annotation 등)는 건너뛴다."""
        lines = self.file.lines
        depth = 0
        for i in range(self.start + 1, self.end):
            s = lines[i].strip()
            if s.startswith(".annotation") or s.startswith(".subannotation"):
                depth += 1
            elif s in (".end annotation", ".end subannotation"):
                depth -= 1
            elif depth == 0 and s and not s.startswith((".", "#")):
                return i
        return self.end

    def insert_at_start(self, code: str) -> None:
        idx = self.first_instruction_index()
        self.file.insert(idx, code)

    def find_lines(self, pattern: str | re.Pattern) -> list[int]:
        rx = re.compile(pattern) if isinstance(pattern, str) else pattern
        return [i for i in range(self.start, self.end + 1) if rx.search(self.file.lines[i])]


@dataclass
class SmaliFile:
    path: Path
    lines: list[str]
    cls: str = ""
    super_cls: str = ""
    dirty: bool = False
    _methods: list[Method] | None = field(default=None, repr=False)

    @classmethod
    def load(cls, path: Path) -> "SmaliFile":
        text = path.read_text(encoding="utf-8")
        f = cls(path=path, lines=text.split("\n"))
        for line in f.lines[:5]:
            if line.startswith(".class"):
                f.cls = line.split()[-1]
            elif line.startswith(".super"):
                f.super_cls = line.split()[-1]
        return f

    def methods(self) -> list[Method]:
        if self._methods is None:
            out = []
            start = None
            hdr = None
            for i, line in enumerate(self.lines):
                if line.startswith(".method "):
                    start, hdr = i, METHOD_RE.match(line)
                elif line.startswith(".end method") and start is not None and hdr:
                    out.append(
                        Method(
                            file=self,
                            start=start,
                            end=i,
                            flags=hdr.group("flags").split(),
                            name=hdr.group("name"),
                            params=hdr.group("params"),
                            ret=hdr.group("ret"),
                        )
                    )
                    start = None
            self._methods = out
        return self._methods

    def insert(self, idx: int, code: str) -> None:
        new = code.strip("\n").split("\n")
        self.lines[idx:idx] = new
        self.dirty = True
        # 삽입 후 메서드 인덱스 재계산
        self._methods = None

    def save(self) -> None:
        if self.dirty:
            self.path.write_text("\n".join(self.lines), encoding="utf-8")
            self.dirty = False


def split_params(params: str) -> list[str]:
    out, i = [], 0
    while i < len(params):
        j = i
        while params[j] == "[":
            j += 1
        if params[j] == "L":
            j = params.index(";", j)
        out.append(params[i : j + 1])
        i = j + 1
    return out


@dataclass
class Fingerprint:
    """대상 메서드를 찾기 위한 조건 묶음. 지정된 조건을 모두 만족해야 매칭된다."""

    name: str
    strings: list[str] = field(default_factory=list)  # 메서드 내 const-string(정확히 일치)
    contains: list[str] = field(default_factory=list)  # 메서드 본문에 포함되어야 하는 부분 문자열
    ret: str | None = None
    params: str | None = None
    method_name: str | None = None
    access: list[str] = field(default_factory=list)  # 예: ["public", "final"]
    custom: Callable[[Method], bool] | None = None

    def matches(self, m: Method) -> bool:
        if self.ret is not None and m.ret != self.ret:
            return False
        if self.params is not None and m.params != self.params:
            return False
        if self.method_name is not None and m.name != self.method_name:
            return False
        if any(a not in m.flags for a in self.access):
            return False
        if self.strings:
            s = set(m.strings)
            if any(x not in s for x in self.strings):
                return False
        if self.contains:
            body = "\n".join(m.body)
            if any(x not in body for x in self.contains):
                return False
        if self.custom and not self.custom(m):
            return False
        return True


class SmaliTree:
    def __init__(self, root: Path):
        self.root = root
        self.dirs = sorted(p for p in root.iterdir() if p.is_dir() and p.name.startswith("smali"))
        self._cache: dict[Path, SmaliFile] = {}
        self._texts: dict[Path, str] | None = None

    def _all_texts(self) -> dict[Path, str]:
        if self._texts is None:
            self._texts = {}
            for d in self.dirs:
                for p in d.rglob("*.smali"):
                    self._texts[p] = p.read_text(encoding="utf-8", errors="replace")
        return self._texts

    def file(self, path: Path) -> SmaliFile:
        if path not in self._cache:
            self._cache[path] = SmaliFile.load(path)
        return self._cache[path]

    def find_class(self, descriptor: str) -> SmaliFile | None:
        rel = descriptor[1:-1] + ".smali"
        for d in self.dirs:
            p = d / rel
            if p.exists():
                return self.file(p)
        return None

    def candidate_files(self, needles: Iterable[str]) -> Iterable[Path]:
        needles = [n for n in needles if n]
        for p, text in self._all_texts().items():
            if all(n in text for n in needles):
                yield p

    def find(self, fp: Fingerprint) -> list[Method]:
        needles = [f'"{s}"' for s in fp.strings] + list(fp.contains)
        out = []
        for p in self.candidate_files(needles):
            for m in self.file(p).methods():
                if fp.matches(m):
                    out.append(m)
        return out

    def find_one(self, fp: Fingerprint) -> Method:
        res = self.find(fp)
        if len(res) != 1:
            raise PatchError(f"fingerprint '{fp.name}' 매칭 {len(res)}개 (1개여야 함): {res[:5]}")
        return res[0]

    def replace_in_all(self, old: str, new: str) -> int:
        """모든 smali 파일에서 문자열 치환(GmsCore 패키지 이름 변경 등에 사용)."""
        n = 0
        for p, text in self._all_texts().items():
            if old in text:
                f = self.file(p)
                f.lines = [l.replace(old, new) for l in f.lines]
                f.dirty = True
                f._methods = None
                n += 1
        return n

    def save(self) -> None:
        for f in self._cache.values():
            f.save()


class PatchError(Exception):
    pass

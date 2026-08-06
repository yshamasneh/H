// tsx uses process.geteuid() only to create a per-user temporary directory.
// Windows does not expose that function; providing a stable non-privileged id
// also avoids uv_os_get_passwd failures seen in constrained Windows runners.
if (process.platform === "win32" && typeof process.geteuid !== "function") {
  Object.defineProperty(process, "geteuid", { value: () => 1000 });
}

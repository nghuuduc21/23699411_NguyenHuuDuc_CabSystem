// Ghi log mỗi dòng một đối tượng JSON.
// Vì sao JSON: `docker compose logs` đọc được bằng mắt, công cụ gom log cũng tách được trường.
// Quy tắc an toàn (CLAUDE.md, NFR08): KHÔNG truyền mật khẩu, token, khóa, dữ liệu cá nhân vào `fields`.

export function createLogger(service) {
  const write = (level, msg, fields = {}) => {
    const line = { time: new Date().toISOString(), level, service, msg, ...fields };
    // Lỗi ghi ra stderr để tách được với log thường khi cần.
    (level === 'error' ? console.error : console.log)(JSON.stringify(line));
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

// Chạy `next dev` với NODE_ENV=development BẤT KỂ môi trường cha đặt gì.
//
// VÌ SAO CẦN FILE NÀY: app hay được start qua DevBox (E:\vihat\tool\vhs\dev-box,
// tab "Apps"). DevBox desktop shell tự nó chạy `next start` nên tiến trình DevBox
// mang NODE_ENV=production, và nó spawn app con bằng `{...process.env}` —
// production chảy thẳng vào `next dev` của repo này. Hậu quả KHÔNG hiển nhiên:
//   - PostCSS/Tailwind không vào pipeline dev → globals.css nổ
//     "Module parse failed: Unexpected character '@'" ngay ở dòng @import 'tailwindcss'
//     (nhìn như lỗi Tailwind, nhưng postcss.config.mjs hoàn toàn đúng);
//   - server đi nhánh production → đòi .next/required-server-files.json, file chỉ
//     sinh ra bởi `next build` → mọi request trả 500.
// `next dev` chỉ CẢNH BÁO "non-standard NODE_ENV" chứ không tự sửa, nên phải ép ở đây.
//
// Dùng script thay vì thêm cross-env: repo này cố ý không có dependency thừa.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Xoá hẳn thay vì gán 'development': Next tự đặt mặc định đúng khi biến vắng mặt.
delete process.env.NODE_ENV;

// Chạy file JS của next bằng chính node đang chạy, KHÔNG qua `npx`/`next.cmd`:
// Node >= 20 trên Windows ném `spawn EINVAL` khi spawn file .cmd mà thiếu shell:true,
// và bật shell:true thì lại phải lo trích dẫn tham số. Đường này tránh cả hai.
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const child = spawn(
  process.execPath,
  [nextBin, 'dev', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);

// Truyền tín hiệu xuống để Ctrl+C không bỏ lại tiến trình next mồ côi.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

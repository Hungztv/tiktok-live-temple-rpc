# Đại Chiến Thủy Cung — TikTok Interactive Live Fishing Game & AI Caster System

Hệ thống game câu cá tương tác trực tiếp trên **TikTok Live** (khung 9:16 cho OBS Studio) kèm **AI Caster** bình luận giọng Việt (`edge-tts` + Web Audio API nhép miệng thời gian thực) và **Dashboard** điều khiển toàn năng (16:9).

---

## 1. Kiến trúc & Cấu trúc thư mục

- **Backend (Python 3.11+):** FastAPI + Uvicorn + WebSocket + SQLAlchemy 2.x Async (SQLite) + `TikTokLive >= 7.x` + `edge-tts`. Backend là nguồn chân lý duy nhất cho mọi tính toán gacha, điểm, HP Boss, Fever và quà tặng; cả sự kiện TikTok thật và Mock Simulator đều đi qua chung một `GameEngine.handle_event(event)`.
- **Frontend (Next.js 16 App Router + TypeScript strict + Tailwind CSS):** Canvas 2D `1080×1920 @ 60FPS`, Framer Motion banner, Lucide React và Web Audio API synthesizer thuần (không cần file hình ảnh/âm thanh rời bên ngoài).

```text
dai-chien-thuy-cung/
├── start.ps1                   # Script khởi chạy 1-Click trên Windows
├── README.md                   # Tài liệu hướng dẫn chi tiết
├── backend/
│   ├── main.py                 # FastAPI app, REST (/health, /api/*) & WS /ws/game
│   ├── config.py               # Cấu hình tĩnh từ .env (CORS, host/port, LLM, TikTok)
│   ├── database.py             # SQLite async + SettingsStore cache RAM
│   ├── models.py               # ORM: players, event_logs, game_settings
│   ├── schemas.py              # Pydantic v2 schemas & ADMIN_COMMAND validation
│   ├── game_engine.py          # GameEngine.handle_event() & scheduler tick 250ms
│   ├── boss_manager.py         # Logic Boss Kraken (HP, rate-limit, thưởng MVP/Last Hit)
│   ├── tiktok_service.py       # Kết nối TikTokLive v7+, lọc streak, tự reconnect
│   ├── tts_service.py          # PriorityQueue, edge-tts, cache LRU, fallback & LLMProvider
│   ├── phrases.py              # 50 câu thoại mẫu chia 9 nhóm + Template Engine an toàn
│   ├── simulator.py            # Mock Simulator đi qua cùng GameEngine.handle_event()
│   ├── requirements.txt        # Phiên bản thư viện đã ghim
│   ├── .env.example            # Mẫu biến môi trường
│   └── tests/                  # Bộ kiểm thử pytest (Phase 1, 2, 3)
└── frontend/
    ├── package.json            # Phiên bản đã ghim (Next 16.4.6, Framer Motion, Lucide)
    ├── app/
    │   ├── page.tsx            # Trang chủ điều hướng & kiểm tra /health
    │   ├── overlay/page.tsx    # Màn hình Game 9:16 cho OBS Studio
    │   └── dashboard/page.tsx  # Bảng điều khiển Admin 5 phân khu
    └── lib/
        ├── types.ts            # Kiểu dữ liệu TypeScript strict khớp Backend
        ├── useGameSocket.ts    # Hook WS tự reconnect + phân vai overlay/dashboard
        ├── soundManager.ts     # Tổng hợp SFX/BGM Web Audio API + Audio Ducking
        └── overlay/
            ├── entities.ts     # Quản lý cá, người chơi, dây câu, hạt particle
            ├── renderer.ts     # Vẽ 3 tầng nước, bờ hồ, nhân vật chibi & bong bóng chat
            ├── effects.ts      # Lưới điện, Tia Laser Lv4, Tàu đánh cá, Boss Kraken
            └── caster.ts       # AI Caster nhép miệng theo AnalyserNode / giả lập + Phụ đề
```

---

## 2. Yêu cầu hệ thống & Khởi chạy 1-Click

### Yêu cầu
- **Python 3.11+** (có `python` và `venv` trong PATH)
- **Node.js LTS** (có `node` và `npm` trong PATH)
- Hệ điều hành Windows 10/11 (khởi chạy bằng `start.ps1`)

### Chạy nhanh 1-Click
Mở PowerShell tại thư mục gốc `dai-chien-thuy-cung` và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Script `start.ps1` sẽ tự động:
1. Tạo môi trường ảo `backend\.venv` và cài đặt thư viện từ `backend\requirements.txt`.
2. Tạo `backend\.env` từ `backend\.env.example` nếu chưa có.
3. Cài đặt `frontend\node_modules` nếu chưa có.
4. Khởi chạy song song Backend (`127.0.0.1:8000`) và Frontend (`127.0.0.1:3000`).
5. Tự động mở trình duyệt tới `/dashboard` và `/overlay`, đồng thời dọn dẹp sạch tiến trình con khi bạn bấm `Ctrl+C`.

---

## 3. Cấu hình `.env` (Tùy chọn nâng cao)

Chỉnh sửa file `backend\.env` nếu muốn dùng thêm:
- `SIGN_API_KEY`: Khoá Sign API cho `TikTokLive` giúp kết nối ổn định hơn khi bị giới hạn tốc độ.
- `LLM_PROVIDER`: Mặc định là `template` (50 câu thoại viết sẵn, không tốn phí, phản hồi tức thì). Có thể đổi sang `gemini` (điền `GEMINI_API_KEY`) hoặc `ollama` (chạy Ollama local tại `OLLAMA_URL`). Nếu API AI lỗi hoặc quá 4 giây, hệ thống tự fallback về Template Engine.

---

## 4. Hướng dẫn nhúng vào OBS Studio (`540×960`)

1. Mở OBS Studio → trong mục **Sources**, bấm `+` → chọn **Browser**.
2. Cấu hình:
   - **URL:** `http://localhost:3000/overlay?transparent=1`
   - **Width:** `540`
   - **Height:** `960`
   - *(Lưu ý: Canvas bên trong vẫn tự động render ở độ phân giải sắc nét `1080×1920` rồi scale mịn xuống khung `540×960`).*
3. Tích chọn **Control audio via OBS** (nếu muốn chỉnh âm lượng game/AI Caster riêng trên Audio Mixer của OBS).
4. Các query parameter hỗ trợ trên `/overlay`:
   - `?transparent=1` — Nền bầu trời trong suốt để ghép đè lên video/webcam trong OBS.
   - `?scale=1` — Phóng full chiều cao cửa sổ trình duyệt.
   - `?debug=1` — Hiện bảng đo FPS, số lượng cá/particle/đạn và trạng thái WebSocket/Audio.

---

## 5. Luật chơi & Tương tác cho Người xem TikTok Live

- **Lên bờ thả cần:** Comment `cau`, `1`, hoặc `tham gia` (không phân biệt hoa/thường và dấu tiếng Việt).
- **Xem điểm & cần câu:** Comment `diem` hoặc `tui` (mỗi người tối đa 1 lần / 5 giây) để hiện bong bóng chat trên đầu nhân vật.
- **Thả Tim (Like):** Tích vào thanh **Nhiệt Độ Hồ Câu** (`0 → 1000`). Đầy `1000` sẽ kích hoạt **FEVER TIME (60 giây)**: x2 tốc độ câu, nước ánh kim, loại bỏ đồ troll và bom.
- **Follow:** Nhận ngay `+1 Mồi Thơm May Mắn` (loại bỏ đồ troll & bom ở lượt câu đó; mỗi tài khoản nhận 1 lần/phiên).
- **Tặng Quà (theo tổng xu):**
  - `1–9 xu` (**Hoa Hồng**): Phóng **Lưới Điện** bắt 3–5 cá xung quanh.
  - `10–99 xu` (**Kem**): Nâng cấp cần câu vĩnh viễn (`Cần Tre Lv1 → Cần Sắt Lv2 → Cần Vàng Lv3 → Pháo Laser Lv4`; đã Lv4 cộng `+500đ`).
  - `100+ xu` (**Sư Tử**): Triệu hồi **Tàu Đánh Cá Cá Nhân** quét sạch mặt hồ, `+2000đ` + Banner vinh danh.
  - `>= 1000 xu` (**TikTok Universe**): Ngoài Tàu Đánh Cá còn **Triệu hồi Boss Kraken** ngay lập tức.
- **Đánh Boss Kraken:** Toàn bộ người chơi dừng câu Gacha chuyển sang bắn Boss (comment bất kỳ `-20 HP`, tối đa 1 phát/giây/người; tặng quà `-100 HP / xu`). Hạ gục Boss thưởng MVP `+5000đ`, Last Hit `+3000đ`, người tham gia `+500đ`.

---

## 6. Checklist Kiểm thử End-to-End (Không cần TikTok Live thật)

Sau khi chạy `start.ps1`, mở đồng thời `/dashboard` và `/overlay`:
1. Trên `/overlay`, bấm nút **🔊 Click để bật âm thanh** (nếu nút đang hiện) để mở khoá Web Audio API.
2. Trên `/dashboard` (Phân khu 2), bấm **Spawn 5 Random Players** → Kiểm tra `/overlay` xuất hiện 5 nhân vật chibi ngồi trên cầu cảng và nghe tiếng quăng cần.
3. Đợi 4–12 giây → Nhân vật tự giật dây câu, hiện điểm bay lên và Top 3 trên HUD nhảy số mượt.
4. Chọn 1 người chơi ở dropdown, bấm nút `"diem"` → Kiểm tra bong bóng chat hiện đúng điểm & tên cần trên đầu nhân vật ở `/overlay`.
5. Bấm **Bơm +200 Tim** 5 lần → Thanh nhiệt độ chạm 1000 → Kiểm tra **FEVER TIME** kích hoạt, nước chuyển sang ánh kim, nhạc nền đổi tiết tấu sôi động.
6. Test 4 nút tặng quà 1-click (`Hoa Hồng`, `Kem`, `Sư Tử`, `Universe`) → Kiểm tra hiệu ứng Lưới điện, Nâng cần lên Lv4 (bắn tia Laser), Tàu đánh cá và **Boss Kraken** vẫy xúc tu + viền nháy đỏ.
7. Trong **AI Caster & Voice Studio**, nhập một câu vào ô **"Đọc ngay"** và nhấn `Enter` → Nghe giọng đọc `edge-tts` phát ra loa, nhạc nền BGM tự hạ xuống 30% (Audio Ducking), nhân vật AI Caster góc phải nhép miệng theo âm thanh và hiện phụ đề tiếng Việt.
8. Chạy bộ kiểm thử tự động:
   - Backend: `cd backend && .\.venv\Scripts\python -m pytest -q`
   - Frontend: `cd frontend && npx.cmd tsc --noEmit && npm.cmd run lint && npm.cmd run build`

---

## 7. Xử lý sự cố thường gặp

- **Windows PowerShell báo lỗi `running scripts is disabled` khi chạy `start.ps1` hoặc `npm`:**
  - Chạy bằng lệnh: `powershell -ExecutionPolicy Bypass -File .\start.ps1`.
- **Overlay không phát ra tiếng trên trình duyệt Chrome/Edge:**
  - Do chính sách Autoplay của trình duyệt, hãy click vào nút màu vàng **🔊 Click để bật âm thanh** trên `/overlay` một lần. Khi chạy trong OBS Browser Source, âm thanh thường tự được phép phát ngay.
- **Không kết nối được phòng TikTok Live / Báo `ERROR` hoặc `Rate Limit`:**
  - Kiểm tra đúng `@username` của tài khoản đang bật livestream công khai. Nếu bị giới hạn tốc độ từ phía TikTok, hãy thêm `SIGN_API_KEY` vào `backend\.env` rồi khởi động lại.
- **Mất mạng hoặc `edge-tts` bị lỗi:**
  - Game vẫn hoạt động bình thường không bị treo; AI Caster tự chuyển sang chế độ phụ đề + nhép miệng giả lập theo độ dài câu (`duration_ms = max(2000, len(text) * 65)`).

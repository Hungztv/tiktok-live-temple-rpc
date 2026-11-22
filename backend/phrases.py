"""Danh sách 50 câu thoại mẫu chia thành 9 nhóm và Template Engine an toàn."""
from __future__ import annotations

import copy
from typing import Any


class SafeFormatDict(dict[str, Any]):
    """Dict dùng với .format_map() an toàn: không báo lỗi nếu thiếu biến hoặc truyền biến lạ."""

    def __missing__(self, key: str) -> str:
        return f"{{{key}}}"


def render_phrase(template: str, **context: Any) -> str:
    """Điền các biến {name}, {item}, {points}, {gift}, {level} vào mẫu câu an toàn."""
    defaults: dict[str, Any] = {
        "name": "Cần thủ",
        "item": "món đồ bí ẩn",
        "points": 0,
        "gift": "món quà",
        "level": 1,
    }
    defaults.update({k: v for k, v in context.items() if v is not None and v != ""})
    return template.format_map(SafeFormatDict(defaults))


DEFAULT_PHRASES: dict[str, list[str]] = {
    "troll_sandal": [
        "Ối giời ơi, {name} giật cần tưởng cá mập, ai dè lên nguyên chiếc {item} huyền thoại!",
        "Chúc mừng {name} vừa vớt được báu vật quốc dân {item}, đem về đi chợ là hết nước chấm!",
        "Cần rung bần bật, {name} kéo lên chiếc {item} trăm lỗ, cá dưới hồ cười nghiêng ngả!",
        "Ai đánh rơi {item} xuống hồ thế này, để {name} câu trúng mất công mừng hụt!",
        "Tưởng nổ hũ to, hóa ra {name} lại sưu tầm thêm một chiếc {item} vào tủ giày!",
        "Kỷ lục mới! {name} câu được {item} không lệch phát nào, đúng chuẩn thợ lặn tìm đồ cổ!",
        "Cá chẳng thấy đâu, chỉ thấy {name} ngậm ngùi xách chiếc {item} ướt nhẹp lên bờ!",
        "Pha giật cần đi vào lòng đất của {name} với chiến lợi phẩm là chiếc {item} thần thánh!",
    ],
    "troll_trash": [
        "Chia buồn cùng {name}, tốn bao nhiêu sức lực mà chỉ kéo lên được {item} dưới đáy hồ!",
        "Hồ câu hôm nay sạch hẳn nhờ công bảo vệ môi trường của {name} với món {item} này!",
        "Tưởng cá quý hiếm, ai ngờ {name} lại vớt trúng {item}, đúng là số nhọ!",
        "Cần câu cong vút mà kết quả của {name} lại là {item}, xin một tràng pháo tay động viên!",
        "Một pha xử lý cồng kềnh từ {name} và phần thưởng là {item} không thể bất ngờ hơn!",
        "Thôi xong, {name} vừa góp phần dọn rác thủy cung bằng cách câu trúng {item}!",
    ],
    "chest_bomb": [
        "Bùm! {name} háo hức mở rương báu nhưng lại trúng ngay {item}, đen hết cả mặt mũi!",
        "Cứ tưởng giàu to, ai dè rương của {name} phát nổ cái đùng với {item} khói bay mù mịt!",
        "Rương này hơi lạ nha {name} ơi, mở ra toàn khói đen từ {item} thôi, không có xu nào!",
        "Một pha mở rương đi vào lịch sử của {name}, nhận ngay hiệu ứng {item} nhọ nồi!",
    ],
    "rare_fish": [
        "Đỉnh của chóp! {name} vừa câu trúng {item} siêu hiếm, ẵm trọn {points} điểm!",
        "Cả hồ dậy sóng! Chúc mừng {name} đã khuất phục được {item}, mang về {points} điểm ngọt lịm!",
        "Quá xuất sắc! {name} giật cần chuẩn xác, kéo lên {item} trị giá {points} điểm!",
        "Tài năng câu cá thiên bẩm là đây! {name} vừa tóm gọn {item} và bỏ túi {points} điểm!",
        "Nổ lớn rồi anh em ơi! {name} may mắn bắt được {item}, cộng thẳng {points} điểm vào bảng vàng!",
        "Không thể tin nổi! {name} vừa lập siêu phẩm với {item}, rinh ngay {points} điểm!",
        "Bàn tay vàng trong làng câu cá gọi tên {name} với pha bắt gọn {item}, nhận {points} điểm!",
        "Thuận buồm xuôi gió! {name} kéo lên {item} khổng lồ, ghi thêm {points} điểm cực gắt!",
    ],
    "gift_small": [
        "Cảm ơn {name} đã gửi tặng {gift}! Lưới điện phóng xuống hồ thu về {points} điểm!",
        "Tuyệt vời! Món quà {gift} của {name} vừa kích hoạt lưới điện bắt gọn đàn cá, cộng {points} điểm!",
        "Đa tạ {name} với món quà {gift} siêu dễ thương, tặng ngay pha giật điện {points} điểm!",
        "Cảm ơn {name} đã tiếp lửa bằng {gift}, lưới điện quét nhẹ cũng mang về {points} điểm!",
    ],
    "gift_upgrade": [
        "Quá chất! Nhờ món quà {gift}, cần câu của {name} đã nâng cấp lên cấp {level} xịn sò!",
        "Cảm ơn {name} đã tặng {gift}! Trang bị câu cá vừa được cường hóa lên cấp {level}!",
        "Lên đời vũ khí! {name} gửi {gift} và sở hữu ngay cần câu cấp {level} cực mạnh!",
        "Đẳng cấp dân chơi! {name} vừa đập {gift} để nâng cần câu lên cấp {level} sáng chói!",
    ],
    "gift_trawler": [
        "Đại gia xuất hiện! Cảm ơn {name} đã tặng {gift}, tàu đánh cá càn quét mặt hồ nhận {points} điểm!",
        "Cả thủy cung chấn động trước món quà {gift} của đại gia {name}, cộng nóng {points} điểm!",
        "Xin ngả mũ trước {name} với siêu phẩm {gift}! Tàu lớn ra khơi mang về {points} điểm vinh danh!",
        "Quá khủng khiếp! Đại gia {name} vừa thả {gift}, gọi tàu đánh cá quét sạch hồ lấy {points} điểm!",
    ],
    "boss_event": [
        "Cảnh báo đỏ! Quái vật biển sâu Kraken đã trồi lên đáy hồ, anh em mau gõ phím bắn hạ nó!",
        "Boss Kraken khổng lồ đang quẫy đạp dữ dội, toàn bộ cần thủ tập trung hỏa lực tấn công ngay!",
        "Chiến thắng vang dội! Boss Kraken đã gục ngã, xin vinh danh chiến thần sát thương {name}!",
        "Quái vật biển sâu đã bị tiêu diệt! Mưa vàng rơi ngập hồ, chúc mừng MVP {name} xuất sắc!",
        "Đòn kết liễu quá đẹp mắt! Cảm ơn {name} và toàn thể anh em đã hợp sức đánh bại Boss Kraken!",
        "Thủy cung bình yên trở lại! Vinh danh người hùng {name} đã dẫn đầu cuộc đại chiến săn Boss!",
    ],
    "idle_chat": [
        "Chào mừng anh em đến với Đại Chiến Thủy Cung! Gõ chữ câu hoặc số 1 để lên bờ thả cần nhé!",
        "Hồ đang rất nhiều cá to và rương báu, anh em comment chữ câu để tham gia đua top ngay nào!",
        "Đừng quên thả tim thật nhiệt tình để đầy thanh nhiệt độ và kích hoạt Fever nhân đôi tốc độ câu!",
        "Muốn biết mình đang có bao nhiêu điểm và cần cấp mấy, anh em chỉ cần gõ chữ điểm hoặc túi nhé!",
        "Follow kênh ngay hôm nay để nhận mồi thơm may mắn, câu phát nào dính cá xịn phát đó nha!",
        "Ai sẽ là Vua Câu Cá thống trị bảng xếp hạng hôm nay? Cùng thả cần và trổ tài ngay thôi anh em ơi!",
    ],
}


def get_default_phrases() -> dict[str, list[str]]:
    """Trả về bản sao sâu của 50 câu thoại mặc định."""
    return copy.deepcopy(DEFAULT_PHRASES)


def count_total_phrases(phrases: dict[str, list[str]] | None = None) -> int:
    data = phrases if phrases is not None else DEFAULT_PHRASES
    return sum(len(items) for items in data.values())

/**
 * 极简 5 段 cron 解析：分 时 日 月 周（0/7 = 周日）。
 * 支持星号、星号斜杠步长（如 每 5 分钟）、a-b 区间、a-b/n、逗号列表。够本地自动化用，不引额外依赖。
 */
function parseField(text, min, max) {
    const values = new Set();
    for (const part of String(text).split(',')) {
        const token = part.trim();
        if (token === '')
            continue;
        const [rangePart, stepPart] = token.split('/');
        const step = stepPart === undefined ? 1 : Number(stepPart);
        if (!Number.isInteger(step) || step <= 0)
            throw new Error(`cron 步长非法: ${token}`);
        let start;
        let end;
        if (rangePart === '*') {
            start = min;
            end = max;
        }
        else if (rangePart.includes('-')) {
            const [a, b] = rangePart.split('-');
            start = Number(a);
            end = Number(b);
        }
        else {
            start = Number(rangePart);
            end = stepPart === undefined ? start : max;
        }
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end)
            throw new Error(`cron 取值非法: ${token}（允许 ${min}-${max}）`);
        for (let value = start; value <= end; value += step)
            values.add(value);
    }
    return values;
}

/** 解析表达式；非法时抛错（调用方负责落成任务错误而不是崩） */
export function parseCron(expression) {
    const fields = String(expression ?? '').trim().split(/\s+/);
    if (fields.length !== 5)
        throw new Error('cron 需要 5 段：分 时 日 月 周');
    const [minute, hour, day, month, weekday] = fields;
    return {
        expression: fields.join(' '),
        minute: parseField(minute, 0, 59),
        hour: parseField(hour, 0, 23),
        day: parseField(day, 1, 31),
        month: parseField(month, 1, 12),
        weekday: parseField(weekday, 0, 7),
        /** 与 Date 匹配（星期 7 视为 0） */
        matches(date) {
            const dow = date.getDay();
            const weekdayOk = this.weekday.has(dow) || (dow === 0 && this.weekday.has(7));
            return this.minute.has(date.getMinutes())
                && this.hour.has(date.getHours())
                && this.day.has(date.getDate())
                && this.month.has(date.getMonth() + 1)
                && weekdayOk;
        },
    };
}

/** 人类可读描述（面板展示用） */
export function describeCron(expression) {
    try {
        return `cron ${parseCron(expression).expression}`;
    }
    catch {
        return `cron 无效: ${expression}`;
    }
}

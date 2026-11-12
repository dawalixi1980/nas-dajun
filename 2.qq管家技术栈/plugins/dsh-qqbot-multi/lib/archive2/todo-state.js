/**
 * /todo 的待办状态：用户发完 /todo 后，只有「同一个发送者」的下一条消息
 * 才被当作任务描述处理。
 *
 * 绑 senderId 的原因：群里有多个机器人时，彼此的发言也会作为入站消息到达，
 * 若不区分发送者，别的机器人一句话就会把待办吃掉。
 *
 *   key = `${botId}:${peerId}`，5 分钟过期，用完即删。
 */
const pending = new Map();
const TTL_MS = 5 * 60 * 1000;

export function setTodoPending(key, senderId) {
    pending.set(key, { senderId: String(senderId ?? ''), expiresAt: Date.now() + TTL_MS });
}

/**
 * 消费待办：只有发送者匹配且未过期才返回 true。
 * 发送者不匹配时**保留**待办，等真正的那个人说话。
 */
export function consumeTodoPending(key, senderId) {
    const record = pending.get(key);
    if (record === undefined) return false;
    if (Date.now() > record.expiresAt) {
        pending.delete(key);
        return false;
    }
    if (String(senderId ?? '') !== record.senderId) return false;
    pending.delete(key);
    return true;
}

export function isTodoPending(key) {
    const record = pending.get(key);
    if (record === undefined) return false;
    if (Date.now() > record.expiresAt) {
        pending.delete(key);
        return false;
    }
    return true;
}

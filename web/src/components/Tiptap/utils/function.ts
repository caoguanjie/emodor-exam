

// 控制输入框，要求输入数字，键盘事件
export function keydownNumber(e: KeyboardEvent | Event) {
    if (e instanceof KeyboardEvent && e.key === 'Backspace') {
        return
    }
    if (e instanceof KeyboardEvent && !/^\d*$/.test(e.key)) {
        e.preventDefault()
    }
}

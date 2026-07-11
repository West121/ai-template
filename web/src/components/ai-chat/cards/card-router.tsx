/**
 * 卡片分发（§3.0）：按 card.type 路由到六类卡片组件。卡片平铺在助手内容列（不进气泡），
 * 全部 w-full min-w-0，宽内容各自容器内横滚。
 */
import type { AiCard } from "../types"
import { ChartCard } from "./chart-card"
import { ConfirmCard } from "./confirm-card"
import { FormCard } from "./form-card"
import { ListCard } from "./list-card"
import { LinkCard, NavigateCard } from "./simple-cards"

export function CardRouter({ card }: { card: AiCard }) {
  switch (card.type) {
    case "navigate":
      return <NavigateCard card={card} />
    case "confirm":
      return <ConfirmCard card={card} />
    case "form":
      return <FormCard card={card} />
    case "list":
      return <ListCard card={card} />
    case "chart":
      return <ChartCard card={card} />
    case "link":
      return <LinkCard card={card} />
    default:
      return null
  }
}

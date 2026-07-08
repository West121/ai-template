import { useNavigate } from "react-router-dom"
import { FileQuestion, House } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <FileQuestion className="size-10" />
      </div>
      <div className="text-center">
        <div className="text-4xl font-bold tracking-tight">404</div>
        <p className="mt-1 text-sm text-muted-foreground">抱歉，你访问的页面不存在或已被移除</p>
      </div>
      <Button className="gap-2" onClick={() => navigate("/dashboard")}>
        <House className="size-4" />
        返回工作台
      </Button>
    </div>
  )
}

import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { cn } from "@/lib/utils"

const EXTENSOES_ACEITAS = [".csv", ".xlsx"]
const TAMANHO_MAXIMO = 5 * 1024 * 1024 // 5 MB

/**
 * Área de upload por clique ou arrastar-e-soltar. Primitivo novo — não existe
 * nenhum no design system. Valida extensão e tamanho aqui mesmo (mensagem
 * pt-BR inline, `role="alert"`); quem usa só recebe um arquivo já válido.
 */
export function FileDrop({
  onFileSelected,
  disabled,
  className,
}: {
  onFileSelected: (file: File) => void
  disabled?: boolean
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function validarEEnviar(file: File) {
    const extensao = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    if (!EXTENSOES_ACEITAS.includes(extensao)) {
      setErro("Formato não aceito. Envie um arquivo CSV ou XLSX.")
      return
    }
    if (file.size > TAMANHO_MAXIMO) {
      setErro("O arquivo excede o limite de 5 MB.")
      return
    }
    setErro(null)
    onFileSelected(file)
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        data-dragover={arrastando || undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastando(false)
          if (disabled) return
          const file = e.dataTransfer.files[0]
          if (file) validarEEnviar(file)
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition-colors",
          !disabled && "cursor-pointer hover:border-primary/60 hover:bg-muted/50",
          arrastando && "border-primary bg-primary/5",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Upload className="size-6" />
        <span>Arraste a planilha aqui ou clique para escolher</span>
        <span className="text-xs">CSV ou XLSX, até 5 MB</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) validarEEnviar(file)
          e.target.value = "" // permite escolher o mesmo arquivo de novo após um erro
        }}
      />
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  )
}

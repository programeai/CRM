import * as React from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

interface SearchInputProps
  extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  /** Texto atual da busca (controlado). */
  value: string
  /** Disparado a cada alteração e também ao limpar (com string vazia). */
  onValueChange: (value: string) => void
}

/**
 * Campo de busca padrão da aplicação: ícone de lupa à esquerda e botão de
 * limpar (×) que aparece quando há texto. É controlado — o debounce e o destino
 * (API ou filtro local) ficam a cargo de quem usa. A largura vem do `className`
 * (o wrapper é `w-full` por padrão; use `max-w-xs` em toolbars, por exemplo).
 */
function SearchInput({
  className,
  value,
  onValueChange,
  placeholder = "Buscar…",
  ...props
}: SearchInputProps) {
  return (
    <div className={cn("relative w-full", className)}>
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className="px-9 [&::-webkit-search-cancel-button]:appearance-none"
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onValueChange("")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-content-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

export { SearchInput }

'use client'

import { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"

export type User = {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
}

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
  },
  {
    accessorKey: "email",
    header: "E-Mail",
  },
  {
    accessorKey: "role",
    header: "Rolle",
    cell: ({ row }) => {
      const role = row.getValue("role") as string
      return <Badge variant="outline">{role}</Badge>
    },
  },
  {
    accessorKey: "createdAt",
    header: "Erstellt am",
    cell: ({ row }) => {
      const date = new Date(row.getValue("createdAt"))
      return date.toLocaleDateString('de-DE')
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const user = row.original

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Menü öffnen</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Aktionen</DropdownMenuLabel>
            <DropdownMenuItem onClick={async () => { try { await navigator.clipboard.writeText(user.id); toast.success("Benutzer-ID kopiert"); } catch { toast.error("Benutzer-ID konnte nicht kopiert werden"); } }}>
              ID kopieren
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
]
"""Extrai o texto do DAS (PDF) preservando a estrutura das tabelas.

Uso:
    python extract_pdf.py [caminho.pdf] [-o saida.txt]

O PDF e um export do Google Docs. A extracao ingenua (PyPDF2, ou o proprio
get_text do PyMuPDF) achata as tabelas em uma linha so e perde o "_" de
identificadores como lab_mode e id_conta. Aqui as celulas sao remontadas a
partir da posicao dos spans no PDF.
"""

import argparse
import re
import sys

import pymupdf

BOX_DRAWING = set("\u2500\u2502\u251c\u2514\u2518\u2510\u250c")
ZERO_WIDTH = "\u200b\u200c\u200d\ufeff"
PARAGRAPH_GAP = 20.0
HEADING_SIZE = 13.5
TITLE_SIZE = 18.0
LIST_MARKER = re.compile(r"^(?:\d+\.|[-*\u2022])\s*$|^(?:\d+\.|[-*\u2022])\s")


def strip_invisible(text):
    for char in ZERO_WIDTH:
        text = text.replace(char, "")
    return text


def center(bbox):
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def inside(bbox, rect):
    cx, cy = center(bbox)
    return rect[0] <= cx <= rect[2] and rect[1] <= cy <= rect[3]


def tidy(text):
    """Normaliza espacos, sem tocar no conteudo."""
    text = re.sub(r"\s+", " ", text).strip()
    # so remove o espaco quando a pontuacao e clearly colada no texto
    # ("mysql2 :", "js )"). Ponto NAO entra: "um .split" e intentional.
    text = re.sub(r"\s+([:;,)\]])", r"\1", text)
    return text


def page_lines(page):
    """Agrupa os spans em linhas, preservando a ordem horizontal real."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for raw in block.get("lines", []):
            spans = [s for s in raw["spans"] if strip_invisible(s["text"]).strip()]
            if not spans:
                continue
            spans.sort(key=lambda s: s["bbox"][0])
            parts = []
            for index, span in enumerate(spans):
                text = strip_invisible(span["text"])
                if index and span["bbox"][0] - spans[index - 1]["bbox"][2] > 1.0:
                    parts.append(" ")
                parts.append(text)
            lines.append(
                {
                    "bbox": tuple(raw["bbox"]),
                    "size": max(round(s["size"], 1) for s in spans),
                    "text": "".join(parts).strip(),
                    "spans": spans,
                }
            )
    lines.sort(key=lambda l: (round(l["bbox"][1], 1), l["bbox"][0]))
    return lines


def code_blocks(lines):
    """Blocos da arvore de diretorios, desenhada com box drawing."""
    blocks = []
    current = None
    for line in lines:
        is_code = any(BOX_DRAWING & set(s["text"]) for s in line["spans"])
        if is_code:
            if current is None:
                current = {
                    "bbox": [line["bbox"][0], line["bbox"][1], line["bbox"][2], line["bbox"][3]],
                    "lines": [],
                }
            box = current["bbox"]
            box[0] = min(box[0], line["bbox"][0])
            box[1] = min(box[1], line["bbox"][1])
            box[2] = max(box[2], line["bbox"][2])
            box[3] = max(box[3], line["bbox"][3])
            current["lines"].append(line)
        elif current is not None:
            blocks.append(current)
            current = None
    if current is not None:
        blocks.append(current)
    return blocks


def fill_table(table, lines):
    """Monta a grade usando o centro de cada span para escolher a celula.

    find_tables().extract() perde o "_" porque o glifo vira um run separado e
    cai na celula vizinha; aqui resolvemos por containment geometrico.
    """
    grid = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            if cell is None:
                cells.append("")
                continue
            found = []
            for line in lines:
                for span in line["spans"]:
                    if inside(span["bbox"], cell):
                        found.append((span["bbox"][1], span["bbox"][0], strip_invisible(span["text"])))
            found.sort()
            cells.append(tidy(" ".join(item[2] for item in found)))
        grid.append(cells)
    return grid


def join_cells(first, second):
    parts = [p for p in (tidy(first), tidy(second)) if p]
    return " ".join(parts)


def render_table(grid, continued):
    if not grid:
        return []
    width = max(len(row) for row in grid)
    grid = [row + [""] * (width - len(row)) for row in grid]
    while len(grid) > 1 and not any(grid[0]):
        grid = grid[1:]

    def escape(value):
        return value.replace("|", "\\|")

    lines = []
    if continued:
        lines.append("[continuacao da tabela da pagina anterior]")
    if not continued:
        lines.append("| " + " | ".join(escape(c) for c in grid[0]) + " |")
        lines.append("| " + " | ".join("---" for _ in range(width)) + " |")
        body = grid[1:]
    else:
        body = grid
    for row in body:
        lines.append("| " + " | ".join(escape(c) for c in row) + " |")
    return lines


def merge_prose(lines):
    """Junta linhas em paragrafos; titulos e itens de lista quebram o bloco."""
    blocks = []
    buffer = []
    previous_y = None

    def flush():
        if buffer:
            blocks.append((tidy(" ".join(t for t, _ in buffer)), buffer[0][1]))
            buffer.clear()

    for line in lines:
        y, text, size = line["bbox"][1], tidy(line["text"]), line["size"]
        if not text:
            continue
        is_heading = size >= HEADING_SIZE
        starts_list = bool(LIST_MARKER.match(text))
        gap = None if previous_y is None else y - previous_y
        new_block = is_heading or starts_list or gap is None or gap > PARAGRAPH_GAP
        if new_block:
            flush()
        if is_heading and not buffer:
            prefix = "# " if size >= TITLE_SIZE else "## "
            blocks.append((prefix + text, y))
        else:
            buffer.append((text, y))
        previous_y = y
    flush()
    return blocks


def extract(path):
    doc = pymupdf.open(path)
    out = []
    previous_was_table = False
    carry_row = None
    carry_head = None

    for number, page in enumerate(doc, start=1):
        if number > 1:
            previous_was_table = False
        lines = page_lines(page)
        found = page.find_tables().tables
        grids = {id(t): fill_table(t, lines) for t in found}
        # Tabela "degradada" (uma unica linha, sem cabecalho) e melhor lida
        # como prosa -- e o caso da caixa "Compatibilidade" na pagina 4.
        tables = [t for t in found if len(grids[id(t)]) > 1]
        table_rects = [t.bbox for t in tables]
        # as linhas de uma caixa de linha unica nao podem voltar para a
        # prosa, senao o texto aparece duas vezes
        dropped = [t for t in found if t not in tables]
        dropped_rects = [t.bbox for t in dropped]
        code = code_blocks(lines)
        code_rects = [b["bbox"] for b in code]

        prose, table_lines = [], []
        for line in lines:
            bbox = line["bbox"]
            if any(inside(bbox, rect) for rect in code_rects):
                continue
            if any(inside(bbox, rect) for rect in table_rects):
                table_lines.append(line)
                continue
            if any(inside(bbox, rect) for rect in dropped_rects):
                continue
            prose.append(line)

        items = []
        for text, y in merge_prose(prose):
            items.append((y, 0, text))
        for block in code:
            items.append((block["bbox"][1], 1, block))
        for table in tables:
            items.append((table.bbox[1], 2, table))
        # caixa de uma linha (rotulo/valor) entra como prosa delimitada
        for table in dropped:
            grid = grids[id(table)]
            label, value = (grid[0] + ["", ""])[:2]
            if value:
                items.append((table.bbox[1], 0, "{0}: {1}".format(label, value)))

        out.append("")
        out.append("=" * 78)
        out.append("PAGINA {0} de {1}".format(number, len(doc)))
        out.append("=" * 78)
        out.append("")

        page_has_table = False
        for _, kind, payload in sorted(items, key=lambda i: (i[0], i[1])):
            if kind == 0:
                out.append(payload)
                out.append("")
            elif kind == 1:
                for line in payload["lines"]:
                    out.append(line["text"].rstrip())
                out.append("")
            else:
                grid = grids[id(payload)]
                # Tabela partida no salto de pagina: a primeira celula ficou
                # na pagina anterior. Fundimos com a ultima linha de dados.
                continued = bool(grid) and not grid[0][0]
                if continued and carry_row:
                    head = grid[0]
                    merged = [
                        join_cells(carry_row[i] if i < len(carry_row) else "", head[i])
                        for i in range(len(head))
                    ]
                    rows = [merged] + grid[1:]
                    if carry_head:
                        rows = [carry_head] + rows
                    grid = rows
                    continued = False
                for line in render_table(grid, continued):
                    out.append(line)
                out.append("")
                if len(grid) > 1:
                    carry_head = grid[0]
                    carry_row = grid[-1]
                page_has_table = True

        previous_was_table = page_has_table

    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "pdf",
        nargs="?",
        default="DAS_v2_2_Revisado_FinBank_ChefLab.pdf",
        help="caminho do PDF de entrada",
    )
    parser.add_argument("-o", "--output", help="arquivo de saida (padrao: mesmo nome com .txt)")
    args = parser.parse_args()

    destination = args.output or re.sub(r"\.pdf$", "", args.pdf, flags=re.I) + ".txt"
    content = extract(args.pdf)

    with open(destination, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)

    print("Extraido {0} -> {1}".format(args.pdf, destination))
    return 0


if __name__ == "__main__":
    sys.exit(main())

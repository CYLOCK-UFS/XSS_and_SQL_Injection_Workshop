import { Router } from 'express';
import {
  LIMITE_AUTOR,
  LIMITE_TEXTO,
  inserirComentario,
  listarComentarios,
} from '../repositories/receitasRepository.js';
import { resetLab } from './labRoutes.js';

const router = Router();

/** Comentarios persistidos, na ordem de exibicao da pagina. */
router.get('/', async (req, res) => {
  const comentarios = await listarComentarios();
  res.json({
    modo: req.labMode,
    total: comentarios.length,
    comentarios,
  });
});

/**
 * XSS armazenado (DAS 4.4).
 * POST /receitas  { nome_autor, texto_comentario }
 *
 * O INSERT e parametrizado nos dois modos. O que muda entre vuln e safe e a
 * RENDERIZACAO da resposta: a pagina ChefLab usa innerHTML no modo vuln
 * (src/public/receitas/receitas.js) e textContent no modo safe.
 */
router.post('/', async (req, res) => {
  const nomeAutor = String(req.body?.nome_autor ?? '').trim();
  const textoComentario = String(req.body?.texto_comentario ?? '').trim();

  if (nomeAutor === '' || textoComentario === '') {
    res.status(400).json({
      erro: 'Informe nome_autor e texto_comentario.',
    });
    return;
  }

  if (nomeAutor.length > LIMITE_AUTOR) {
    res.status(400).json({
      erro: `nome_autor deve ter no maximo ${LIMITE_AUTOR} caracteres.`,
    });
    return;
  }

  if (textoComentario.length > LIMITE_TEXTO) {
    res.status(400).json({
      erro: `texto_comentario deve ter no maximo ${LIMITE_TEXTO} caracteres.`,
    });
    return;
  }

  const comentario = await inserirComentario({
    nomeAutor,
    textoComentario,
  });

  res.status(201).json({ modo: req.labMode, comentario });
});

/**
 * Alias de laboratorio do reset oficial (DAS, secao 7).
 * O contrato oficial e POST /api/reset; esta rota existe por compatibilidade.
 */
router.post('/reset', resetLab);

export default router;

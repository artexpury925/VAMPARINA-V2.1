import express from 'express';
const router = express.Router();

router.get('/', async (req, res) => {
    res.send(`<h2>Pairing in progress... Keep this tab open.</h2>`);
});

export default router;
"""Synthetic Python example for CiteTrace; inspection does not execute this file."""


class ResearchModel:
    def normalize(self, values):
        scale = sum(value * value for value in values) / len(values)
        return [value / (scale + 1e-6) ** 0.5 for value in values]


def squared_error(prediction, target):
    return (prediction - target) ** 2

